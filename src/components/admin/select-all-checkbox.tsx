"use client";

import * as React from "react";

export function SelectAllCheckbox({
  formId,
}: {
  formId: string;
}) {
  const [allChecked, setAllChecked] = React.useState(false);

  const getTargets = React.useCallback(() => {
    return Array.from(
      document.querySelectorAll<HTMLInputElement>(
        `input[name="ids"][form="${formId}"]`,
      ),
    );
  }, [formId]);

  const syncState = React.useCallback(() => {
    const targets = getTargets();
    if (targets.length === 0) {
      setAllChecked(false);
      return;
    }
    setAllChecked(targets.every((target) => target.checked));
  }, [getTargets]);

  React.useEffect(() => {
    syncState();
    const onChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if (target.name !== "ids" || target.form?.id !== formId) {
        return;
      }
      syncState();
    };
    document.addEventListener("change", onChange);
    return () => {
      document.removeEventListener("change", onChange);
    };
  }, [formId, syncState]);

  return (
    <input
      type="checkbox"
      aria-label="전체 선택"
      checked={allChecked}
      onChange={(event) => {
        const nextChecked = event.target.checked;
        getTargets().forEach((target) => {
          target.checked = nextChecked;
        });
        setAllChecked(nextChecked);
      }}
      className="h-4 w-4 accent-foreground"
    />
  );
}
