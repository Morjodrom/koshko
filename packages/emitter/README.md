# Koshko emitter

`@koshko/emitter` is the state-library-neutral page-side transport for Koshko
Inspector. It creates validated signal and state-mutation messages and posts
them to the current window for capture by the extension.

State-library adapters should depend on this package rather than implementing
their own wire transport.
