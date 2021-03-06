// @flow
import p from 'path'
import * as t from 'babel-types'
import type { State } from './types'
// import blog from 'babel-log'

const PKG_NAME = 'react-intl'
const FUNC_NAME = 'defineMessages'

const isImportLocalName = (name: string, { file }: State) => {
  const imports = file.metadata.modules.imports
  const intlImports = imports.find(x => x.source === PKG_NAME)
  if (intlImports) {
    const specifier = intlImports.specifiers.find(x => x.imported === FUNC_NAME)
    if (specifier) {
      return specifier.local === name
    }
  }

  return false
}

const REG = new RegExp(`\\${p.sep}`, 'g')

const dotPath = (str: string) => str.replace(REG, '.')

const getPrefix = (
  {
    file: { opts: { filename } },
    opts: { removePrefix = '', filebase = false },
  }: State,
  exportName: string | null
) => {
  if (removePrefix === true) {
    return exportName === null ? '' : exportName
  }
  const file = p.relative(process.cwd(), filename)
  const fomatted = filebase ? file.replace(/\..+$/, '') : p.dirname(file)
  removePrefix = removePrefix === false ? '' : removePrefix
  const fixed = dotPath(fomatted).replace(
    new RegExp(`^${removePrefix.replace(/\//g, '')}\\${dotPath(p.sep)}?`),
    ''
  )
  const result = exportName === null ? fixed : `${fixed}.${exportName}`
  return result
}

const getId = (path, prefix) => {
  let name

  if (path.isStringLiteral()) {
    name = path.node.value
  } else if (path.isIdentifier()) {
    name = path.node.name
  }

  if (!name) {
    throw new Error(`requires Object key or string literal`)
  }

  return dotPath(p.join(prefix, name))
}

const isLiteral = node => t.isStringLiteral(node) || t.isTemplateLiteral(node)

const isValidate = (path: Object, state: State): boolean => {
  const callee = path.get('callee')
  if (!callee.isIdentifier()) {
    return false
  }

  if (!isImportLocalName(callee.node.name, state)) {
    return false
  }

  const messagesObj = path.get('arguments')[0]

  if (
    !messagesObj ||
    !(messagesObj.isObjectExpression() || messagesObj.isIdentifier())
  ) {
    return false
  }

  return true
}

const getLeadingComment = prop => {
  const commentNodes = prop.node.leadingComments
  return commentNodes
    ? commentNodes.map(node => node.value.trim()).join('\n')
    : null
}

const replaceProperties = (
  properties: $ReadOnlyArray<Object>,
  state: State,
  exportName: string | null
) => {
  const prefix = getPrefix(state, exportName)

  for (const prop of properties) {
    const propValue = prop.get('value')

    const messageDescriptorProperties = []

    // { defaultMessage: 'hello', description: 'this is hello' }
    if (propValue.isObjectExpression()) {
      const objProps = propValue.get('properties')

      // { id: 'already has id', defaultMessage: 'hello' }
      const isNotHaveId = objProps.every(v => v.get('key').node.name !== 'id')
      if (isNotHaveId) {
        const id = getId(prop.get('key'), prefix)

        messageDescriptorProperties.push(
          t.objectProperty(t.stringLiteral('id'), t.stringLiteral(id))
        )
      }

      messageDescriptorProperties.push(...objProps.map(v => v.node))

      // 'hello' or `hello ${user}`
    } else if (isLiteral(propValue)) {
      const id = getId(prop.get('key'), prefix)

      messageDescriptorProperties.push(
        t.objectProperty(t.stringLiteral('id'), t.stringLiteral(id)),
        t.objectProperty(t.stringLiteral('defaultMessage'), propValue.node)
      )
    }

    const extractComments =
      state.opts.extractComments === undefined
        ? true
        : state.opts.extractComments

    if (extractComments) {
      const hasDescription = messageDescriptorProperties.find((v: Object) => {
        return v.key.name === 'description'
      })

      if (!hasDescription) {
        const description = getLeadingComment(prop)

        if (description) {
          messageDescriptorProperties.push(
            t.objectProperty(
              t.stringLiteral('description'),
              t.stringLiteral(description)
            )
          )
        }
      }
    }

    propValue.replaceWith(t.objectExpression(messageDescriptorProperties))
  }
}

const getExportName = (
  namedExport,
  defaultExport,
  includeExportName
): string | null => {
  if (includeExportName && namedExport) {
    return namedExport.get('declaration.declarations.0.id.name').node
  }

  if (includeExportName === 'all' && defaultExport) {
    return 'default'
  }

  return null
}

export default function() {
  return {
    name: 'react-intl-auto',
    visitor: {
      CallExpression(path: Object, state: State) {
        if (!isValidate(path, state)) {
          return
        }

        const namedExport = path.findParent(v => v.isExportNamedDeclaration())
        const defaultExport = path.findParent(v =>
          v.isExportDefaultDeclaration()
        )
        const exportName = getExportName(
          namedExport,
          defaultExport,
          state.opts.includeExportName || false
        )
        const messagesObj = path.get('arguments')[0]

        let properties

        if (messagesObj.isObjectExpression()) {
          properties = messagesObj.get('properties')
        } else if (messagesObj.isIdentifier()) {
          const name = messagesObj.node.name
          const obj = messagesObj.scope.getBinding(name)
          if (!obj) {
            return
          }
          properties = obj.path.get('init').get('properties')
        }

        if (properties) {
          replaceProperties(properties, state, exportName)
        }
      },
    },
  }
}
