"""Generate a code-only UI overlay. No private HTML, rows or sheet data are read."""
from pathlib import Path
import hashlib
import json
base = Path(__file__).resolve().parent
# This is the matcher for the already deployed c2247c0 document, not UI source.
# Edit live-data.js for new behavior; changing this baseline needs a coordinated
# private-document deployment and verification of that document's exact bytes.
legacy_adapter = (base / 'legacy-live-data.js').read_text()
legacy_sha256 = 'da886af1bf4c96efbbd1bfcb568b41b88d057208214e031d53307b40a91a3c90'
if hashlib.sha256(legacy_adapter.encode('utf-8')).hexdigest() != legacy_sha256:
    raise SystemExit('Deployed legacy adapter mismatch. Keep legacy-live-data.js frozen; edit live-data.js instead.')
names = ['live-comparison.js', 'live-reference-layout.js', 'live-empty-pages.js',
         'live-analysis-drilldown.js', 'live-pages-reference.js', 'live-rates-restored.js', 'live-duration-reference.js',
         'live-payout-config.js', 'live-filter-controls.js', 'live-configuration.js', 'live-provider-aliases.js', 'live-provider-summary.js', 'live-provider-orders.js','live-provider-sticky.js', 'live-collected-data.js', 'live-report-data.js', 'live-withdraw-pages.js', 'live-deposit-issues.js', 'live-sync-health.js', 'live-data.js']
styles = ['live-restored.css', 'live-reference-pages.css', 'live-payout-config.css', 'live-configuration.css', 'live-sync-health.css', 'live-analysis-drilldown.css', 'live-report-data.css']
values = {'oldAdapter': legacy_adapter,
          'newModules': '\n'.join((base / name).read_text() for name in names),
          'restoredCss': '\n'.join((base / name).read_text() for name in styles)}
assert '</script' not in values['newModules'].lower()
assert '</style' not in values['restoredCss'].lower()
out = base.parent / 'src/lib/adminPreviewRestore.generated.ts'
out.write_text('// Code-only restoration. Contains no source snapshots or private document.\n' +
               '\n'.join('export const '+key+' = '+json.dumps(value, ensure_ascii=False)+';'
                         for key, value in values.items())+'\n')
print('Generated code-only restoration:', out.stat().st_size, 'bytes')
