import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
const files = await Promise.all(['index.html', 'styles.css', 'views.js', 'app.js'].map(name => readFile(new URL('../src/' + name, import.meta.url), 'utf8')));
const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const data = await readFile(new URL('../src/students.js', import.meta.url), 'utf8');
const juryFiles = {};
for (const [name, mime] of [['Dekana_Process.pdf', 'application/pdf'], ['Dekana_Source.zip', 'application/zip'], ['Dekana_Demo.mp4', 'video/mp4']]) {
  try {
    const bytes = await readFile(new URL('../jury/' + name, import.meta.url));
    juryFiles['/jury/' + name] = {name, mime, base64:bytes.toString('base64')};
  } catch (error) {
    if(error.code !== 'ENOENT') throw error;
  }
}
const documents = {};
for (const student of ['nord','vega']) {
  for (const type of ['study','transcript']) {
    const bytes = await readFile(new URL('../fixtures/' + student + '-' + type + '.pdf', import.meta.url));
    documents['student.' + student + ':' + type] = bytes.toString('base64');
  }
}
const output = new URL('../dist/', import.meta.url);
await mkdir(new URL('server/', output), {recursive:true});
await mkdir(new URL('.openai/', output), {recursive:true});
await copyFile(new URL('../.openai/hosting.json', import.meta.url), new URL('.openai/hosting.json', output));
await writeFile(new URL('server/index.js', output), 'const assets = ' + JSON.stringify(files) + ';\nconst juryFiles = ' + JSON.stringify(juryFiles) + ';\nconst documents = ' + JSON.stringify(documents) + ';\n' + data + '\n' + server);
