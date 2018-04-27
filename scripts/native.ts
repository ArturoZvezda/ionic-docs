import * as fs from 'fs';
import * as path from 'path';
import * as config from './config';
import * as docgen from './nativeDocgen';
import * as git from './git';
import * as npm from './npm';
import { execp, vlog } from './utils';

const distList = `${config.NATIVE_DIR}/dist/@ionic-native`;
const menuPath = 'src/components/docs-menu/native-menu.ts';
const menuHeader = 'export const nativeMenu = ';

const navList = {};

// the main task of the API documentation generation process
export async function generate() {
  const startTime = new Date().getTime();

  const repoRef = await git.ensureLatestMaster(
    config.NATIVE_DIR,
    config.NATIVE_REPO_URL,
    'v5'
  );

  vlog('installing and building');
  await execp([
    `cd ${config.NATIVE_DIR}`,
    'npm i',
    'npm run build',
  ].join(' && '));

  vlog('Reading output typescript data file');
  const typeDoc = await getTypeDoc();

  typeDoc.children.forEach(tsData => processPlugin(tsData));

  // write nav
  const ts = `${menuHeader}${JSON.stringify(navList, null, '  ')}`;
  fs.writeFileSync(menuPath, ts);

  const endTime = new Date().getTime();
  console.log(`Native Docs copied in ${endTime - startTime}ms`);
}

async function getTypeDoc() {
  vlog('generating native docs json');
  await execp([
    `cd ${config.NATIVE_DIR} && ../../node_modules/.bin/typedoc`,
    '--json dist/docs.json --mode modules',
    'src/@ionic-native/plugins/*/index.ts'
  ].join(' '));

  return JSON.parse(
    fs.readFileSync(`${config.NATIVE_DIR}/dist/docs.json`, `utf8`)
  );
}

// parse plugin data and write to markdown file
function processPlugin(tsData) {

  const plugin = preparePluginData(tsData);

  if (!fs.existsSync(config.NATIVE_DOCS_DIR)) {
    fs.mkdirSync(config.NATIVE_DOCS_DIR);
  }

  navList[plugin.prettyName] = `/docs/native/${plugin.npmName}`;

  fs.writeFileSync(
    path.join(config.NATIVE_DOCS_DIR, `${plugin.npmName}.md`),
    docgen.getPluginMarkup(plugin)
  );
}


function preparePluginData(tsData) {

  const tsChild = getTSChild(tsData.children);
  const name = tsChild.name;

  if (name === 'ActionSheet') {
    const test = selectChild(tsChild.decorators, 'name', 'Plugin').arguments.config;
  }

  let metaArgs = {};
  if (tsChild.decorators[0].arguments && tsChild.decorators[0].arguments.config) {
    // here be dragons, this is very fragile
    // So we can avoid an `eval()`, we convert the object syntax string to valid
    // JSON. Unexected syntax in the refference decorator will break it.
    // console.log(tsChild.decorators[0].arguments.config)
    const str = tsChild.decorators[0].arguments.config
    .replace(/\n/g, ' ')
    .replace(/\"/g, '\\"')
    .replace(/\'/g, '"')
    .replace(/([\{|,])\s*(\w+):/g, '$1 "$2":')
    .replace(/, }/g, '}')
    ;
    // console.log(str);
    metaArgs = JSON.parse(str);
  }

  return {
    name: name,
    prettyName: selectChild(tsChild.comment.tags, 'tag', 'name').text || name,
    description: selectChild(tsChild.comment.tags, 'tag', 'description').text,
    installation: metaArgs['install'],
    repo: metaArgs['repo'],
    npmName: tsData.name.replace('\"', '').replace('/index', '').replace('"', ''),
    cordovaName: metaArgs['plugin'],
    platforms: metaArgs['platforms'],
    usage: selectChild(tsChild.comment.tags, 'tag', 'usage') ?
      selectChild(tsChild.comment.tags, 'tag', 'usage').text : null,
    members: getNonInheritedMembers(tsChild.children),
    interfaces: tsData.children.filter(child => child.kindString === 'Interface')
  };
}

function selectChild(children, key, val) {
  for (let i = 0; i < children.length; i++) {
    if (children[i][key] === val) {
      return children[i];
    }
  }
}

function getNonInheritedMembers(members) {
  return members.filter(member => !(
    member.inheritedFrom &&
    member.inheritedFrom.name.indexOf('IonicNativePlugin') === 0
  )).map(member => {
    // normalize member format
    return {
      name: member.name,
      kind: member.kindString,
      description: member.signatures && member.signatures[0].comment ?
        member.signatures[0].comment.shortText :
        member.comment ? member.comment.shortText : '',
      returns: member.signatures ? {
        description: member.signatures && member.signatures[0].comment ?
          member.signatures[0].comment.returns : null,
        name: member.signatures[0].type.name,
        type: member.signatures && member.signatures[0].type.typeArguments ?
          member.signatures[0].type.typeArguments[0].name : null
      } : null,
      params: member.signatures && member.signatures[0].parameters ?
      member.signatures[0].parameters.map(param => ({
        name: param.name,
        description: param.type.type === 'reference' ?
          `See ${param.type.name} table below` :
          param.comment ? param.comment.text : null,
        type: param.type.name,
        optional: param.flags && !!param.flags.isOptional
      })) : null
    };
  }).sort((a, b) => {
    if (a.name === b.name) return 0;
    return a.name > b.name;
  });
}

function getTSChild(children) {
  // We know the name, because it's the class that's exported

  for (let i = 0; i < children.length; i++) {
    if (children[i].kindString === 'Class' && children[i].flags.isExported) {
      return children[i];
    }
  }
}

