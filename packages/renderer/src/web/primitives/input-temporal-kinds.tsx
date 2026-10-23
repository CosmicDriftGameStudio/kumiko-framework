import { DateInput } from "./date-input.tsx";
import { localeBoundsProps, stateProps } from "./input-optional-props.ts";
import type { KindRenderer } from "./input-shared.ts";
import { LocatedTimestampInput } from "./located-timestamp-input.tsx";
import { TimestampInput } from "./timestamp-input.tsx";
import { TzInput } from "./tz-input.tsx";

export const renderDateKind: KindRenderer<"date"> = (props) => (
  <DateInput
    id={props.id}
    name={props.name}
    value={props.value}
    onChange={props.onChange}
    {...localeBoundsProps(props)}
    {...stateProps(props)}
  />
);

export const renderTimestampKind: KindRenderer<"timestamp"> = (props) => (
  <TimestampInput
    id={props.id}
    name={props.name}
    value={props.value}
    onChange={props.onChange}
    {...(props.wallClock !== undefined && { wallClock: props.wallClock })}
    {...localeBoundsProps(props)}
    {...stateProps(props)}
  />
);

export const renderLocatedTimestampKind: KindRenderer<"locatedTimestamp"> = (props) => (
  <LocatedTimestampInput
    id={props.id}
    name={props.name}
    value={props.value}
    onChange={props.onChange}
    {...localeBoundsProps(props)}
    {...stateProps(props)}
  />
);

export const renderTzKind: KindRenderer<"tz"> = (props) => (
  <TzInput
    id={props.id}
    name={props.name}
    value={props.value}
    onChange={props.onChange}
    {...stateProps(props)}
  />
);
