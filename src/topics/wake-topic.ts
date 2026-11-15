/** The two ways to wake a Dormant Topic, in the Mac's words. */
export type Wake = 'reopen' | 'start-fresh';

export const WAKE_LABEL: Record<Wake, string> = {
  reopen: 'Reopen',
  'start-fresh': 'Start Fresh',
};
