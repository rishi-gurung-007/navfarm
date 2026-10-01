import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("dialog dismiss actions", () => {
  it("uses the dialog header close control instead of duplicate footer dismiss buttons", () => {
    expect(read("src/components/console/inventory/requisition-new-dialog.tsx")).not.toContain(
      'onClick={onClose}>{t("rqNewCancel")}',
    );
    expect(read("src/modules/master-data/EntityLookupField.tsx")).not.toContain(">Done</Button>");
    expect(read("src/components/console/approvals/approvals-page-shell.tsx")).not.toContain(
      'variant="outline" onClick={() => setViewingItem(null)}',
    );
  });
});
