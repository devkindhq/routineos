import { Fieldset } from "@mantine/core";

// Disables everything inside it and says why. A fieldset disables every form control below it natively, so the
// buttons and radios inside need no prop of their own. With no reason it renders its children untouched.
export default function Gated({ reason, children, inline }) {
  if (!reason) return children;
  return (
    <Fieldset disabled title={reason} variant="unstyled" m={0} display={inline ? "inline-block" : "block"}>
      {children}
    </Fieldset>
  );
}
