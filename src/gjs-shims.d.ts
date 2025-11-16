// Minimal shims so TypeScript doesn't complain about GJS imports.

declare module 'gi://St' {
  const St: any;
  export default St;
}

declare module 'gi://Clutter' {
  const Clutter: any;
  export default Clutter;
}

declare module 'gi://Gio' {
  const Gio: any;
  export default Gio;
}

declare module 'gi://GLib' {
  const GLib: any;
  export default GLib;
}

declare module 'resource:///org/gnome/shell/ui/main.js' {
  const Main: any;
  export = Main;
}

declare module 'resource:///org/gnome/shell/ui/panelMenu.js' {
  const PanelMenu: any;
  export = PanelMenu;
}

declare module 'resource:///org/gnome/shell/extensions/extension.js' {
  export class Extension {}
}

// GJS global log() function
declare function log(message?: any, ...optionalParams: any[]): void;
