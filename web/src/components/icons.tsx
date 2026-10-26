/** Simple stroke icons (no icon library needed). */
type P = { className?: string };
const base = (className?: string) => ({
  className: className ?? "h-5 w-5",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconHome = ({ className }: P) => (<svg {...base(className)}><path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" /></svg>);
export const IconDumbbell = ({ className }: P) => (<svg {...base(className)}><path d="M6 6v12M18 6v12M3 9v6M21 9v6M6 12h12" /></svg>);
export const IconFood = ({ className }: P) => (<svg {...base(className)}><path d="M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4" /></svg>);
export const IconPeople = ({ className }: P) => (<svg {...base(className)}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3 20c0-3 3-5 6-5s6 2 6 5M15 15c3 0 6 1.5 6 4.5" /></svg>);
export const IconUser = ({ className }: P) => (<svg {...base(className)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>);
export const IconPlus = ({ className }: P) => (<svg {...base(className)}><path d="M12 5v14M5 12h14" /></svg>);
export const IconMic = ({ className }: P) => (<svg {...base(className)}><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>);
export const IconCamera = ({ className }: P) => (<svg {...base(className)}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>);
export const IconScan = ({ className }: P) => (<svg {...base(className)}><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" /><rect x="7" y="8" width="10" height="8" rx="1" /></svg>);
export const IconSpeaker = ({ className }: P) => (<svg {...base(className)}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9a4 4 0 0 1 0 6" /></svg>);
export const IconMute = ({ className }: P) => (<svg {...base(className)}><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l4 6M21 9l-4 6" /></svg>);
export const IconBack = ({ className }: P) => (<svg {...base(className)}><path d="M15 6l-6 6 6 6" /></svg>);
export const IconClose = ({ className }: P) => (<svg {...base(className)}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IconCheck = ({ className }: P) => (<svg {...base(className)}><path d="M5 12l5 5L20 7" /></svg>);
export const IconPause = ({ className }: P) => (<svg {...base(className)}><path d="M9 5v14M15 5v14" /></svg>);
export const IconPlay = ({ className }: P) => (<svg {...base(className)}><path d="M7 5l12 7-12 7z" /></svg>);
export const IconSend = ({ className }: P) => (<svg {...base(className)}><path d="M4 12l16-8-6 16-2-7z" /></svg>);
export const IconFlip = ({ className }: P) => (<svg {...base(className)}><path d="M4 7h13l-3-3M20 17H7l3 3" /></svg>);
export const IconTrash = ({ className }: P) => (<svg {...base(className)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>);
export const IconAlert = ({ className }: P) => (<svg {...base(className)}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>);
export const IconBody = ({ className }: P) => (<svg {...base(className)}><circle cx="12" cy="5" r="2" /><path d="M12 7v6l-4 7M12 13l4 7M7 10h10" /></svg>);
