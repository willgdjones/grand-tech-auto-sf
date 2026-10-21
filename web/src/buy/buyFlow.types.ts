export interface CropRecipe { rotation: 0 | 90 | 180 | 270; mode: 'fill' | 'fit'; bg: string; zoom: number; centreU: number; centreV: number }
export type BuyState = { phase: 'idle' } | { phase: 'draft'; boardId: string; week: string } | { phase: 'checkout'; rentalId: string; url: string } | { phase: 'review'; rentalId: string };
