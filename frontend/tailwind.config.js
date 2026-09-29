/** @type {import('tailwindcss').Config} */
export default {
  // Tell Tailwind which files to scan for class names
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      // Custom colors for the control-room aesthetic
      colors: {
        'sg-dark':    '#0a0e1a',   // deep navy background
        'sg-panel':   '#111827',   // panel/card background
        'sg-border':  '#1f2937',   // subtle borders
        'sg-accent':  '#3b82f6',   // blue accent
        'sg-high':    '#ef4444',   // HIGH severity red
        'sg-medium':  '#f59e0b',   // MEDIUM severity amber
        'sg-low':     '#22c55e',   // LOW severity green
        'sg-verified':'#22c55e',   // verified green
        'sg-dismissed':'#6b7280',  // dismissed grey
      },
    },
  },
  plugins: [],
};
