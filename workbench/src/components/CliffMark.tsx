import cliffMascotUrl from "../assets/cliff-mascot.gif?url";

export function CliffMark({className = "", animated = false}: {className?: string; animated?: boolean}) {
  const classes = `cliff-mark ${className}`.trim();
  if (!animated) return <img className={classes} src="/favicon.svg" alt="" aria-hidden="true" />;
  return <picture className={classes}>
    <source media="(prefers-reduced-motion: reduce)" srcSet="/favicon.svg" />
    <img src={cliffMascotUrl} alt="" aria-hidden="true" />
  </picture>;
}
