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
names = ['live-chart-tooltip.js', 'live-amount-bands.js', 'live-member-counts.js', 'live-submission-analysis.js', 'live-comparison.js', 'live-reference-layout.js', 'live-empty-pages.js',
         'live-analysis-drilldown.js', 'live-matrix-custom-range.js', 'live-pages-reference.js', 'live-rates-restored.js', 'live-duration-reference.js',
         'live-payout-config.js', 'live-filter-controls.js', 'live-configuration.js', 'live-provider-aliases.js', 'live-provider-intake.js', 'live-provider-summary.js', 'live-provider-orders.js','live-provider-sticky.js', 'live-collected-data.js', 'live-report-data.js', 'live-pending-snapshot.js', 'live-pending-analysis.js', 'live-pending-orders.js', 'live-withdraw-pages.js', 'live-workorder-reconciliation-batch.js','live-workorder-operations.js', 'live-kyc-reconciliation.js', 'live-deposit-workspace.js', 'live-deposit-issues.js', 'live-sync-health.js', 'live-presence.js', 'live-success-analysis.js', 'live-daily-comparison.js', 'live-collector-control.js', 'live-channel-status.js', 'live-data.js']
styles = ['live-chart-tooltip.css', 'live-restored.css', 'live-matrix-custom-range.css', 'live-reference-pages.css', 'live-payout-config.css', 'live-configuration.css', 'live-kyc-reconciliation.css', 'live-sync-health.css', 'live-analysis-drilldown.css', 'live-report-data.css', 'live-pending-analysis.css', 'live-pending-orders.css', 'live-presence.css', 'live-success-analysis.css', 'live-platform-coverage.css', 'live-daily-comparison.css','live-collector-control.css','live-channel-status.css']
values = {'oldAdapter': legacy_adapter,
          'newModules': '\n'.join((base / name).read_text() for name in names),
          'restoredCss': '\n'.join((base / name).read_text() for name in styles)}
assert '</script' not in values['newModules'].lower()
assert '</style' not in values['restoredCss'].lower()
out = base.parent / 'src/lib/adminPreviewRestore.generated.ts'
out.write_text('// Code-only restoration. Contains no source snapshots or private document.\n' +
               '\n'.join('export const '+key+': string = '+json.dumps(value, ensure_ascii=False)+';'
                         for key, value in values.items())+'\n')
print('Generated code-only restoration:', out.stat().st_size, 'bytes')
