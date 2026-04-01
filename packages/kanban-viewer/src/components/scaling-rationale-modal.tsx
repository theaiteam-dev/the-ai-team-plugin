'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ScalingRationaleModalProps } from '@/types/scaling-modal';

export function ScalingRationaleModal({ scalingRationale }: ScalingRationaleModalProps) {
  const [open, setOpen] = useState(false);

  if (!scalingRationale) {
    return null;
  }

  const { instanceCount, depGraphMaxPerStage, memoryBudgetCeiling, bindingConstraint, concurrencyOverride } = scalingRationale;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Scaling
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Scaling Rationale</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Instance count</dt>
            <dd>{instanceCount}</dd>

            <dt className="text-muted-foreground">Dep graph max per stage</dt>
            <dd>{depGraphMaxPerStage}</dd>

            <dt className="text-muted-foreground">Memory budget ceiling</dt>
            <dd>{memoryBudgetCeiling}</dd>

            <dt className="text-muted-foreground">Binding constraint</dt>
            <dd>{bindingConstraint}</dd>

            <dt className="text-muted-foreground">Concurrency override</dt>
            <dd>{concurrencyOverride !== null ? concurrencyOverride : '—'}</dd>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
