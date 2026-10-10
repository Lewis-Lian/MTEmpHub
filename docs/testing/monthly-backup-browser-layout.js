// Run in cua_repl after uploading a backup with cross-month/annual rows.
// The caller supplies a tab connected to an isolated test database.
// jsdom cannot verify the modal's flex layout or actual scroll area.
async function assertMonthlyBackupListVisible(tab) {
  const size = await tab.playwright.getByRole('dialog', {name: '导入月度账套', exact: true})
    .evaluate(dialog => {
      const list = dialog.querySelector('.backup-differences');
      return {height: list.clientHeight, rows: list.children.length};
    });
  if (!size.rows || size.height <= 0) {
    throw new Error(`Backup rows are inaccessible: ${size.rows} rows, ${size.height}px scroll area`);
  }
  return size;
}
