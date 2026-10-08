import { m } from '@/paraglide/messages.js';
import { Pricing } from '@/blocks/pricing';
import { Dialog, DialogContent } from '@/components/ui/dialog';

// "Out of credits" dialog for the homepage generator. Its own module so the
// dialog code is only downloaded once it is first opened (blocks/zombie-trend).
export default function PaywallDialog({
  open,
  onOpenChange,
  note,
  redirect,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the plans are showing, e.g. "you have X credits, this needs Y". */
  note?: string;
  /** Where checkout returns to (default: the current page). */
  redirect?: string;
  /** Signed-out click on a plan (default: go to /sign-in). */
  onSignIn?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-6 sm:max-w-5xl">
        {note && (
          <p className="bg-muted rounded-lg px-4 py-3 text-center text-sm font-medium">
            {note}
          </p>
        )}
        <Pricing
          variant="dialog"
          title={m['zombie.paywall.title']()}
          redirect={redirect}
          onSignIn={onSignIn}
        />
      </DialogContent>
    </Dialog>
  );
}
