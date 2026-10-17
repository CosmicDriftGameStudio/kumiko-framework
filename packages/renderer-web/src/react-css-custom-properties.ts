// Deliberate consumer-wide effect: this augmentation ships in the emitted .d.ts, so every
// app compiling against renderer-web may use `--name` keys in `style` objects. React passes
// them through unchanged; csstype only lists standard properties.
declare module "react" {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}

export {};
