/* These libraries ship no TypeScript types; we use them through narrow,
   locally-typed wrappers in printer.ts, so ambient `any` is acceptable. */
declare module 'net-snmp';
declare module 'ipp';
