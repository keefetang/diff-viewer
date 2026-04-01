// Type declarations for untyped third-party modules

// Svelte component imports
declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
