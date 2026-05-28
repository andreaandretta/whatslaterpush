export const LABEL_PALETTE = [
  { hex: '#DB4437', name: 'red'    },
  { hex: '#E65100', name: 'orange' },
  { hex: '#827717', name: 'olive'  },
  { hex: '#0F9D58', name: 'green'  },
  { hex: '#00897B', name: 'teal'   },
  { hex: '#1976D2', name: 'blue'   },
  { hex: '#7E57C2', name: 'purple' },
  { hex: '#546E7A', name: 'gray'   },
] as const;

export type LabelColor = typeof LABEL_PALETTE[number]['hex'];

export function isValidLabelColor(c: string): c is LabelColor {
  return LABEL_PALETTE.some((p) => p.hex === c);
}
