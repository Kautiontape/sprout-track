import { BreastMilkBagLogResponse } from '@/app/api/types';

export interface BreastMilkBagFormProps {
  isOpen: boolean;
  onClose: () => void;
  babyId: string | undefined;
  initialTime: string;
  /** Present when editing an existing entry rather than creating one. */
  activity?: BreastMilkBagLogResponse;
  onSuccess?: () => void;
}

/** Reasons offered when taking bags out. Additions use 'Initial Stock' or nothing. */
export const BAG_REMOVAL_REASONS = ['Fed', 'Discarded', 'Donated', 'Other'] as const;
