// Temp syntax validator — parses ESM + JSX with Babel's parser (esbuild isn't
// installed in this frontend). Deleted right after use.
const parser = require('@babel/parser');
const fs = require('fs');
let bad = 0;
for (const f of process.argv.slice(2)) {
  try {
    parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    console.log('OK   ' + f);
  } catch (e) {
    bad++;
    console.error('FAIL ' + f + '\n     ' + e.message);
  }
}
process.exit(bad ? 1 : 0);
