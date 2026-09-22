/**
 * Applies the stored theme before first paint, so a viewer who chose dark mode
 * never sees a white flash. Kept tiny and inline on purpose.
 */
const script = `(function(){try{var t=localStorage.getItem('casestudyhub-theme');if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
