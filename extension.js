const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Meta = imports.gi.Meta;
const Pango = imports.gi.Pango;
const St = imports.gi.St;
const Params = imports.misc.params;
const AltTab = imports.ui.altTab;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const THUMBNAIL_SCALE = 0.1;

function isWindows(binding) {
  return (binding == 'switch-windows' || binding == 'switch-windows-backward');
}

function isGroup(binding) {
  return (binding == 'switch-group' || binding == 'switch-group-backward');
}

function isPanels(binding) {
  return (binding == 'switch-panels' || binding == 'switch-panels-backward');
}

function getTabList(all, group, window, workspaceOpt, screenOpt) {
  let screen = screenOpt || global.screen;
  let display = screen.get_display();
  let workspace = workspaceOpt || screen.get_active_workspace();
  let tracker = Cinnamon.WindowTracker.get_default();

  let windows = []; // the array to return
  let winlist = []; // the candidate windows

  if (!all) {
    winlist = display.get_tab_list(Meta.TabList.NORMAL_ALL, screen, workspace);
    if (group) {
      let app;
      if (window && Main.isInteresting(window)) {
        app = tracker.get_window_app(window);
      } else {
        app = winlist.length > 0 ? tracker.get_window_app(winlist[0]) : null;
      }
      winlist = app ? app.get_windows() : (window && Main.isInteresting(window) ? [window] : (winlist[0] ? [winlist[0]] : []));
    }
  } else {
    let n = screen.get_n_workspaces();
    for (let i = 0; i < n; i ++) {
      winlist = winlist.concat(display.get_tab_list(Meta.TabList.NORMAL_ALL,
        screen, screen.get_workspace_by_index(i)));
    }
  }

  let registry = {}; // to avoid duplicates 
  for (let i = 0; i < winlist.length; ++i) {
    let win = winlist[i];
    if (Main.isInteresting(win)) {
      let seqno = win.get_stable_sequence();
      if (!registry[seqno]) {
        windows.push(win);
        registry[seqno] = true; // there may be duplicates in the list (rare)
      }
    }
  }
  // from cinnamon_app_compare_windows()
  windows.sort(Lang.bind(this, function(w1, w2) {
    let ws_1 = w1.get_workspace() == global.screen.get_active_workspace();
    let ws_2 = w2.get_workspace() == global.screen.get_active_workspace();

    if (ws_1 && !ws_2)
      return -1;
    else if (!ws_1 && ws_2)
      return 1;

    let vis_1= w1.showing_on_its_workspace();
    let vis_2 = w2.showing_on_its_workspace();

    if (vis_1 && !vis_2)
      return -1;
    else if (!vis_1 && vis_2)
      return 1;

    return (w2.get_user_time() - w1.get_user_time());
  }));
  return windows;
}

function ThumbnailGrid(params) {
  this._init(params);
}

ThumbnailGrid.prototype = {
  _init: function(params) {
    params = Params.parse(params, { rowLimit: null,
      colLimit: null, spacing: 10 });
    this.rowLimit = params.rowLimit;
    this.colLimit = params.colLimit;
    this.spacing = params.spacing;

    this.actor = new St.BoxLayout({ vertical: true });
    this.tWidth = 1;
    this.tHeight = 1;
    this.grid = new Cinnamon.GenericContainer();
    this.titleLabel = new St.Label({ style: 'font-weight: bold' });
    this.titleBin = new St.Bin();
    this.titleBin.set_child(this.titleLabel);
    this.actor.add(this.titleBin);
    this.actor.add(this.grid, { expand: true, y_align: St.Align.START });

    this.grid.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));
    this.grid.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
    this.grid.connect('allocate', Lang.bind(this, this._allocate));
  },

  _setTitle: function(text, demandsAttention) {
    this.titleLabel = new St.Label({text: text, style: 'font-weight: bold'});
    this.titleBin.set_child(this.titleLabel);
    this.titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    let parentnode = this.actor.get_parent() ? this.actor.get_parent().get_parent().get_theme_node() : null;
    this.titleLabel.clutter_text.width = Math.min(this.titleLabel.clutter_text.width,
      Math.floor(this.grid.width + (parentnode ? parentnode.get_horizontal_padding() : 0)));
    this.titleBin.set_position (Math.floor((this.grid.width - this.titleLabel.width) / 2),
      Math.floor(-(parentnode ? parentnode.get_padding(St.Side.TOP) : 0) + this.titleLabel.height / 8));
  },

  _calcTSize: function() {
    let children = this.grid.get_children();
    children.forEach(Lang.bind(this, function(child) {
      this.tWidth = Math.max(this.tWidth, child.get_preferred_size()[2]);
    }));
    children.forEach(Lang.bind(this, function(child) {
      this.tHeight = Math.max(this.tHeight, child.get_preferred_size()[3]);
    }));
    this.tWidth = Math.ceil(this.tWidth);
    this.tHeight = Math.ceil(this.tHeight);
  },

  _getPreferredWidth: function(actor, forHeight, alloc) {
    let children = this.grid.get_children();
    this._calcTSize();
    let nColumns = this.colLimit ? Math.min(this.colLimit,
      children.length) : children.length;
    let totalSpacing = Math.max(0, nColumns - 1) * this.spacing;
    alloc.min_size = this.tWidth;
    alloc.natural_size = nColumns * this.tWidth + totalSpacing;
  },

  _getVisibleChildren: function() {
    let children = this.grid.get_children();
    children = children.filter(function(actor) {
      return actor.visible;
    });
    return children;
  },

  _getPreferredHeight: function(actor, forWidth, alloc) {
    let children = this._getVisibleChildren();
    this._calcTSize();
    let [nColumns, usedWidth] = this._computeLayout(forWidth);
    let nRows;
    if (nColumns > 0)
      nRows = Math.ceil(children.length / nColumns);
    else
      nRows = 0;
    if (this.rowLimit)
      nRows = Math.min(nRows, this.rowLimit);
    let totalSpacing = Math.max(0, nRows - 1) * this.spacing;
    let height = nRows * this.tHeight + totalSpacing;
    alloc.min_size = height;
    alloc.natural_size = height;
  },

  _allocate: function(grid, box, flags) {
    let children = this._getVisibleChildren();
    let availWidth = box.x2 - box.x1;
    let availHeight = box.y2 - box.y1;

    this._calcTSize();
    let [nColumns, usedWidth] = this._computeLayout(availWidth);

    let leftPadding = Math.floor((availWidth - usedWidth) / 2);

    let x = box.x1 + leftPadding;
    let y = box.y1 + this.titleLabel.height;
    let columnIndex = 0;
    let rowIndex = 0;

    for (let i = 0; i < children.length; i++) {
      let childBox = new Clutter.ActorBox();
      if (St.Widget.get_default_direction() == St.TextDirection.RTL) {
        let _x = box.x2 - (x + this.tWidth);
        childBox.x1 = Math.floor(_x);
      } else {
        childBox.x1 = Math.floor(x);
      }
      childBox.y1 = Math.floor(y);
      childBox.x2 = childBox.x1 + this.tWidth;
      childBox.y2 = childBox.y1 + this.tHeight;

      if (this.rowLimit && rowIndex >= this.rowLimit) {
        this.grid.set_skip_paint(children[i], true);
      } else {
        children[i].allocate(childBox, flags);
        this.grid.set_skip_paint(children[i], false);
      }

      columnIndex++;
      if (columnIndex == nColumns) {
        columnIndex = 0;
        rowIndex++;
      }

      if (columnIndex == 0) {
        y += this.tHeight + this.spacing;
        x = box.x1 + leftPadding;
      } else {
        x += this.tWidth + this.spacing;
      }
    }
    this.nColumns = nColumns;
    this.nRows = rowIndex + (columnIndex == 0 ? 0 : 1);
  },

  _computeLayout: function(forWidth) {
    let nColumns = 0;
    let usedWidth = 0;

    while ((this.colLimit == null || nColumns < this.colLimit) &&
        (usedWidth + this.tWidth <= forWidth)) {
      usedWidth += this.tWidth + this.spacing;
      nColumns += 1;
    }

    if (nColumns > 0)
      usedWidth -= this.spacing;

    return [nColumns, usedWidth];
  },

  removeAll: function() {
    this.grid.get_children().forEach(Lang.bind(this, function(child) {
      child.destroy();
    }));
  },

  addItem: function(actor) {
    this.grid.add_actor(actor);
  }
};
 

function AltTabPopup() {
  this._init();
}

AltTabPopup.prototype = {
  __proto__ : AltTab.AltTabPopup.prototype,

  _init: function() {
    AltTab.AltTabPopup.prototype._init.call(this);
    this._oldBinding = null;
    this._oldWindows = [];
    this._changeWS = false;
    this._changedWS = false;
    this._changedBinding = false;
  },

  refresh: function(binding, backward) {
    if (this._appSwitcher) {
      if (this._clearPreview) this._clearPreview();
      if (this._thumbnails) this._destroyThumbnails();
      this.actor.remove_actor(this._appSwitcher.actor);
      this._appSwitcher.thumbGrid.removeAll();
      this._appSwitcher.actor.destroy();
    }

    this._currentApp = 0;
    this._currentWindow = -1;

    let all = isPanels(binding);
    let group = isGroup(binding);

    let windows = getTabList(all, group);
    if (this._changeWS) {
      this._changeWS = false;
      this._changedWS = true;
      binding = this._oldBinding;
      if (this._oldWindows.length > 0 && !isWindows(binding))
        windows = this._oldWindows;
    }
    if (this._changedBinding && isGroup(binding)) {
      windows = getTabList(false, true, this._window);
      this._window = null;
      this._changedBinding = false;
    }
    if (windows.length > 0) {
      this._oldWindows = windows;
      this._oldBinding = binding;
    }
    
    this._appSwitcher = new AppSwitcher(windows, this);
    this.actor.add_actor(this._appSwitcher.actor);

    this._appSwitcher.connect('item-activated', Lang.bind(this, this._appActivated));
    this._appSwitcher.connect('item-entered', Lang.bind(this, this._appEntered));

    this._appIcons = this._appSwitcher.icons;

    this._appSwitcher.actor.opacity = 0;
    if (windows.length < 1 || this._appIcons.length == 0) {
      this._finish();
      return false;
    }
    this.actor.show();
    this.actor.get_allocation_box();

    // Make the initial selection
    if (this._appIcons.length > 0) {
      if (binding == 'no-switch-windows' || this._changedWS
          || this._appIcons.length == 1) {
        this._select(0);
      } else if (backward) {
        this._select(this._appIcons.length - 1);
      } else {
        this._select(1);
      }
      this._appSwitcher.thumbGrid._setTitle(this._appIcons[this._currentApp]._title, this._appIcons[this._currentApp]._demandsAttention);
      this._changedWS = false;
    }

    // There's a race condition; if the user released Alt before
    // we got the grab, then we won't be notified. (See
    // https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
    // details.) So we check now. (Have to do this after updating
    // selection.)
    let [x, y, mods] = global.get_pointer();
    if (!(mods & this._modifierMask)) {
      this._finish();
      return false;
    }
    Tweener.addTween(this._appSwitcher.actor, {
      opacity: 255,
      time: AltTab.POPUP_FADE_OUT_TIME,
      transition: 'easeInQuad'
    });

    // We delay showing the popup so that fast Alt+Tab users aren't
    // disturbed by the popup briefly flashing.
    this._initialDelayTimeoutId = Mainloop.timeout_add(AltTab.POPUP_DELAY_TIMEOUT,
      Lang.bind(this, function() {
        this._appSwitcher.actor.opacity = 255;
        this._initialDelayTimeoutId = 0;
      }));

    return true;
  },

  show: function(backward, binding, mask) {
    this._thumbnailsEnabled = false;
    this._previewEnabled = true;
    if (!Main.pushModal(this.actor))
      return false;
    this._haveModal = true;
    this._modifierMask = AltTab.primaryModifier(mask);

    if (!this.refresh(binding, backward)) {
      return false;
    }

    this.actor.connect('key-press-event', Lang.bind(this, this._keyPressEvent));
    this.actor.connect('key-release-event', Lang.bind(this, this._keyReleaseEvent));

    this.actor.connect('button-press-event', Lang.bind(this, this._clickedOutside));
    this.actor.connect('scroll-event', Lang.bind(this, this._onScroll));

    return true;
  },

  _finish: function() {
    let showOSD = false;
    if (this._appIcons.length > 0) {
      let app = this._appIcons[this._currentApp];
      showOSD = (app.cachedWindows[0].get_workspace() != global.screen.get_active_workspace());
      Main.activateWindow(app.cachedWindows[0]);
    }
    this.destroy();
    if (showOSD) Main.wm.showWorkspaceOSD();
  },

  _keyPressEvent: function(actor, event) {
    let that = this;
    var switchWorkspace = function(direction) {
      if (global.screen.n_workspaces < 2) {
        return false;
      }
      let current = global.screen.get_active_workspace_index();
      let nextIndex = (global.screen.n_workspaces + current + direction) % global.screen.n_workspaces;
      global.screen.get_workspace_by_index(nextIndex).activate(global.get_current_time());
      if (current == global.screen.get_active_workspace_index()) {
        return false;
      }
      Main.wm.showWorkspaceOSD();
      that._changeWS = true;
      that.refresh('no-switch-windows');
      return true;
    };
    let keysym = event.get_key_symbol();
    let event_state = Cinnamon.get_event_state(event);
    let backwards = event_state & Clutter.ModifierType.SHIFT_MASK;
    let action = global.display.get_keybinding_action(event.get_key_code(), event_state);

    this._disableHover();
    let nRows = this._appSwitcher.thumbGrid.nRows;
    let nColumns = this._appSwitcher.thumbGrid.nColumns;
    if (keysym == Clutter.Escape) {
      this.destroy();
    } else if (keysym == Clutter.Return) {
      this._finish();
      return true;
    } else if (action == Meta.KeyBindingAction.SWITCH_WINDOWS ||
        action == Meta.KeyBindingAction.SWITCH_GROUP ||
        action == Meta.KeyBindingAction.SWITCH_PANELS) {
      if ((isWindows(that._oldBinding) || isPanels(that._oldBinding))
          && action == Meta.KeyBindingAction.SWITCH_GROUP &&
          !this._changedBinding) {
        that._changedBinding = true;
        that._window = this._appIcons[this._currentApp].cachedWindows[0];
        that.refresh('switch-group', backwards);
        return false;
      }
      this._select(backwards ? this._previousApp() : this._nextApp());
    } else {
      let ctrlDown = event_state & Clutter.ModifierType.CONTROL_MASK;
      if (keysym == Clutter.Left) {
        if (ctrlDown) {
          if (switchWorkspace(-1)) {
            return false;
          }
        }
        this._select(this._previousApp());
      } else if (keysym == Clutter.Right) {
        if (ctrlDown) {
          if (switchWorkspace(1)) {
            return false;
          }
        }
        this._select(this._nextApp());
      } else if (keysym == Clutter.Down) {
        this._select(Math.min(AltTab.mod(this._currentApp + nColumns,
          nColumns * nRows), this._appIcons.length - 1));
      } else if (keysym == Clutter.Up) {
        this._select(Math.min(AltTab.mod(this._currentApp - nColumns,
          nColumns * nRows), this._appIcons.length - 1));
      } else if (keysym == Clutter.Home) {
        this._select(0);
      } else if (keysym == Clutter.End) {
        this._select(this._appIcons.length - 1);
      }
    }

    if (this._appIcons.length > 0)
      this._appSwitcher.thumbGrid._setTitle(this._appIcons[this._currentApp]._title, this._appIcons[this._currentApp]._demandsAttention);
    return true;
  }
};

function AppIcon(window, showThumbnail) {
  this._init(window, showThumbnail);
}

AppIcon.prototype = {
  __proto__ : AltTab.AppIcon.prototype,

  _init: function(window, showThumbnail) {
    AltTab.AppIcon.prototype._init.call(this, window, showThumbnail);
    this._title = window.get_title() ? window.get_title() : (this.app ? this.app.get_name() : " ");
    this._demandsAttention = (window.is_urgent && (window.is_demanding_attention() || window.is_urgent()));
    this.label.destroy();
    this.label = new St.Label({ text: this._title });
    this.win = window.get_compositor_private().get_texture();
    let [width, height] = this.win.get_size();
    this.set_scale(width, height);
    this.set_size(Math.ceil(Math.max(width, height) * this.scale));
  },

  set_scale: function(width, height) {
    let monitor = Main.layoutManager.primaryMonitor;
    this.scale = Math.min(1.0, monitor.width * THUMBNAIL_SCALE / width, monitor.height * THUMBNAIL_SCALE / height);
  },

  set_size: function(size) {
    AltTab.AppIcon.prototype.set_size.call(this, size);
    if (this.showThumbnail) {
      let iconSize = 32;
      let iconOverlap = 3;

      let [width, height] = this.getSize();
      if (this.icon.get_children().length > 1) {
        this.set_scale(width / this.scale, height / this.scale);
        AltTab.AppIcon.prototype.set_size.call(this, Math.ceil(Math.max(this.win.width, this.win.height) * this.scale));
        [width, height] = this.getSize();
      }
      let iconLeft = width - (iconSize - iconOverlap);
      let iconTop = height - (iconSize - iconOverlap);

      if (this._appIcon) {
        this.actor.remove(this._appIcon);
        this._appIcon.destroy();
      }

      this._appIcon = this.app ? (this.window.minimized ?
        this.app.get_faded_icon(iconSize) :
        this.app.create_icon_texture(iconSize)) :
        new St.Icon({ icon_name: 'application-default-icon',
          icon_type: St.IconType.FULLCOLOR,
          icon_size: iconSize });
      this._appIcon.set_position(iconLeft, iconTop);
      this.actor.add(this._appIcon);
      this._iconBin.set_size(width, height);
    }
  },

  getSize: function() {
    let children = this.icon.get_children();
    if (children.length < 1) {
      return [this.icon.width, this.icon.height];
    }
    let [width, height] = [1, 1];
    for (let i = 0; i < children.length; i++) {
      width = Math.max(width, children[i].width + children[i].x);
      height = Math.max(height, children[i].height + children[i].y);
    }
    width = Math.ceil(width);
    height = Math.ceil(height);
    return [width, height];
  }
};

function AppSwitcher() {
  this._init.apply(this, arguments);
}

AppSwitcher.prototype = {
  __proto__ : AltTab.AppSwitcher.prototype,

  _init: function(windows, altTabPopup) {
    AltTab.SwitcherList.prototype._init.call(this, true);

    let thumbnails = [];
    for (let i = 0; i < windows.length; i++) {
      let thumb = new AppIcon(windows[i], true);
      thumb.cachedWindows = [windows[i]];
      thumbnails.push(thumb);
    }

    this.icons = [];
    this._arrows = [];

    this.thumbGrid = new ThumbnailGrid();
 
    this._scrollableRight = false;
    this._clipBin.child = this.thumbGrid.actor;

    this.actor.connect('get-preferred-height', Lang.bind(this, this._getPreferredHeight));
    this.actor.connect('get-preferred-width', Lang.bind(this, this._getPreferredWidth));

    for (let i = 0; i < thumbnails.length; i++)
      this._addThumbnail(thumbnails[i]);

    this._curApp = -1;
    this._iconSize = 0;
    this._altTabPopup = altTabPopup;
    this._mouseTimeOutId = 0;
  },

  _addThumbnail: function(appIcon) {
    this.icons.push(appIcon);
    this.addItem(appIcon.actor, appIcon.label);

    let arrow = new St.DrawingArea({ style_class: 'switcher-arrow' });
    this._list.add_actor(arrow);
    this._arrows.push(arrow);
    arrow.hide();
  },

  addItem: function(item, label) {
    let bbox = new St.Button({ style_class: 'item-box', reactive: true, x_align: St.Align.MIDDLE, y_align: St.Align.END });

    bbox.set_child(item);

    let n = this._items.length;
    bbox.connect('clicked', Lang.bind(this, function() { this._onItemClicked(n); }));
    bbox.connect('enter-event', Lang.bind(this, function() { this._onItemEnter(n); }));

    this.thumbGrid.addItem(bbox);
    this._items.push(bbox);
  },

  highlight: function(index, justOutline) {
    //AltTab.SwitcherList.prototype.highlight.call(this, index, justOutline);
    if (this._highlighted != -1) {
      this._items[this._highlighted].remove_style_pseudo_class('outlined');
      this._items[this._highlighted].remove_style_pseudo_class('selected');
    }

    this._highlighted = index;

    if (this._highlighted != -1) {
      this._items[this._highlighted].add_style_pseudo_class('outlined');
      this._items[this._highlighted].add_style_pseudo_class('selected');
    }
    //Add scrolling here later on
  },

  _getColLimit: function() {
    this.thumbGrid._calcTSize();
    let node = this._altTabPopup.actor.get_theme_node();
    this.padFactor = node.get_horizontal_padding() + node.get_length('spacing');
    return this.thumbGrid._computeLayout(global.screen_width - this.padFactor)[0];
  },

  _getPreferredWidth: function(actor, forHeight, alloc) {
    let colLimit = this._getColLimit();
    this.thumbGrid.colLimit = colLimit;
    let nColumns = Math.min(colLimit, this.thumbGrid._getVisibleChildren().length);
    alloc.natural_size = alloc.min_size = nColumns * this.thumbGrid.tWidth + Math.max(0, nColumns - 1) * this.thumbGrid.spacing + this.padFactor;
  },

  _getPreferredHeight: function(actor, forWidth, alloc) {
    let colLimit = this._getColLimit();
    let nRows = Math.ceil(this.thumbGrid._getVisibleChildren().length / colLimit);
    alloc.natural_size = alloc.min_size = this.thumbGrid.tHeight * nRows + this.thumbGrid.spacing * Math.max(nRows - 1, 0)
      + this.thumbGrid.titleLabel.height + this._altTabPopup.actor.get_theme_node().get_vertical_padding();
  }
};

function startTab(display, screen, window, binding) {
  let modifiers = binding.get_modifiers ();
  let backwards = modifiers & Meta.VirtualModifier.SHIFT_MASK;
  let tabPopup = new AltTabPopup();
  if(!tabPopup.show(backwards, binding.get_name(), binding.get_mask()))
    tabPopup.destroy();
}

function init() {
}

function enable() {
  Meta.keybindings_set_custom_handler('switch-windows', startTab);
  Meta.keybindings_set_custom_handler('switch-group', startTab);
  Meta.keybindings_set_custom_handler('switch-panels', startTab);
  Meta.keybindings_set_custom_handler('switch-windows-backward', startTab);
  Meta.keybindings_set_custom_handler('switch-group-backward', startTab);
}

function disable() {
  Meta.keybindings_set_custom_handler('switch-windows', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
  Meta.keybindings_set_custom_handler('switch-group', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
  Meta.keybindings_set_custom_handler('switch-panels', Lang.bind(Main.wm, Main.wm._startA11ySwitcher));
  Meta.keybindings_set_custom_handler('switch-windows-backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
  Meta.keybindings_set_custom_handler('switch-group-backward', Lang.bind(Main.wm, Main.wm._startAppSwitcher));
}
