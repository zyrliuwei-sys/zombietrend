import { m } from '@/paraglide/messages.js';
import { Pricing } from '@/blocks/pricing';
import { Dialog, DialogContent } from '@/components/ui/dialog';

// "Out of credits" dialog for the homepage generator. Its own module so the
// dialog code is only downloaded once it is first opened (blocks/zombie-trend).
export default function PaywallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-5xl">
        <Pricing variant="dialog" title={m['zombie.paywall.title']()} />
      </DialogContent>
    </Dialog>
  );
}
