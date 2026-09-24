"""Generate a code-only UI overlay. No private HTML, rows or sheet data are read."""
from pathlib import Path
import json
base = Path(__file__).resolve().parent
names = ['live-comparison.js', 'live-reference-layout.js', 'live-empty-pages.js',
         'live-pages-reference.js', 'live-rates-restored.js', 'live-duration-reference.js',
         'live-payout-config.js', 'live-data.js']
styles = ['live-restored.css', 'live-reference-pages.css', 'live-payout-config.css']
values = {'oldAdapter': (base / 'legacy-live-data.js').read_text(),
          'newModules': '\n'.join((base / name).read_text() for name in names),
          'restoredCss': '\n'.join((base / name).read_text() for name in styles)}
assert '</script' not in values['newModules'].lower()
assert '</style' not in values['restoredCss'].lower()
out = base.parent / 'src/lib/adminPreviewRestore.generated.ts'
out.write_text('// Code-only restoration. Contains no source snapshots or private document.\n' +
               '\n'.join('export const '+key+' = '+json.dumps(value, ensure_ascii=False)+';'
                         for key, value in values.items())+'\n')
print('Generated code-only restoration:', out.stat().st_size, 'bytes')
