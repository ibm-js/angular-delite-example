/** @module delite/HasDropDown */
define([
	"dcl/dcl",
	"dojo/Deferred",
	"dojo/dom-class", // domClass.add domClass.contains domClass.remove
	"dojo/when",
	"./keys", // keys.DOWN_ARROW keys.ENTER keys.ESCAPE
	"./place",
	"./popup",
	"./Widget",
	"./activationTracker",		// for delite-deactivated event
	"dpointer/events"		// so can just monitor for "pointerdown"
], function (dcl, Deferred, domClass, when, keys, place, popup, Widget) {
	/**
	 * Base class for widgets that need drop down ability.
	 * @mixin module:delite/HasDropDown
	 * @augments module:delite/Widget
	 */
	return dcl(Widget, /** @lends module:delite/HasDropDown# */ {
		/**
		 * The button/icon/node to click to display the drop down.
		 * Can be set in a template via a `attach-point` assignment.
		 * If missing, then either `this.focusNode` or `this.domNode` (if `focusNode` is also missing) will be used.
		 * @member {Element}
		 * @protected
		 */
		buttonNode: null,

		/**
		 * Will set CSS class `d-up-arrow-button`, `d-down-arrow-button`, `d-right-arrow-button` etc. on this node
		 * depending on where the drop down is set to be positioned.
		 * Can be set in a template via a `attach-point` assignment.
		 * If missing, then `this.buttonNode` will be used.
		 * @member {Element}
		 * @protected
		 */
		arrowWrapperNode: null,

		/**
		 * The node to set the `aria-expanded` class on.
		 * Can be set in a template via a `attach-point` assignment.
		 * If missing, then `this.focusNode` or `this.buttonNode` (if `focusNode` is missing) will be used.
		 * @member {Element}
		 * @protected
		 */
		popupStateNode: null,

		/**
		 * The node to display the popup around.
		 * Can be set in a template via a `attach-point` assignment.
		 * If missing, then `this.domNode` will be used.
		 * @member {Element}
		 * @protected
		 */
		aroundNode: null,

		/**
		 * The widget to display as a popup.  Applications/subwidgets should *either*:
		 *
		 * 1. define this property
		 * 2. override `loadDropDown()` to return a dropdown widget or Promise for one
		 * 3. setup a listener for the delite-display-load event that [asynchronously] resolves the event's
		 *   `loadDeferred` Promise to the dropdown
		 * @member {Element}
		 */
		dropDown: null,

		/**
		 * If true, make the drop down at least as wide as this widget.
		 * If false, leave the drop down at its default width.
		 * Has no effect when `dropDownPosition = ["center"]`.
		 * @member {boolean}
		 * @default true
		 */
		autoWidth: true,

		/**
		 * If true, make the drop down exactly as wide as this widget.  Overrides `autoWidth`.
		 * Has no effect when `dropDownPosition = ["center"]`.
		 * @member {boolean}
		 * @default false
		 */
		forceWidth: false,

		/**
		 * The maximum height for our dropdown.
		 * Any dropdown taller than this will have a scroll bar.
		 * Set to 0 for no max height, or -1 to limit height to available space in viewport.
		 * @member {number}
		 * @default -1
		 */
		maxHeight: -1,

		/**
		 * Controls the position of the drop down.
		 * It's an array of strings with the following values:
		 *
		 * - before: places drop down to the left of the target node/widget, or to the right in
		 * the case of RTL scripts like Hebrew and Arabic
		 * - after: places drop down to the right of the target node/widget, or to the left in
		 * the case of RTL scripts like Hebrew and Arabic
		 * - above: drop down goes above target node
		 * - below: drop down goes below target node
		 * - center: drop down is centered on the screen, like a dialog; when used, this should be
		 *   the only choice in the array
		 *
		 * The positions are tried, in order, until a position is found where the drop down fits
		 * within the viewport.
		 *
		 * @member {string[]}
		 * @default ["below", "above"]
		 */
		dropDownPosition: ["below", "above"],

		/**
		 * Whether or not the drop down is open.
		 * @member {boolean}
		 * @readonly
		 */
		opened: false,

		/**
		 * Callback when the user mousedown/touchstart on the arrow icon.
		 * @private
		 */
		_dropDownPointerDownHandler: function () {
			if (this.disabled || this.readOnly) {
				return;
			}

			// In the past we would call e.preventDefault() to stop things like text selection,
			// but it doesn't work on IE10 (or IE11?) since it prevents the button from getting focus
			// (see #17262), so not doing it at all for now.
			//
			// Also, don't stop propagation, so that:
			//		1. TimeTextBox etc. can focus the <input> on mousedown
			//		2. dropDownButtonActive class applied by CssState (on button depress)
			//		3. user defined onMouseDown handler fires

			this._docHandler = this.on("pointerup", this._dropDownPointerUpHandler.bind(this), this.ownerDocument.body);

			this.toggleDropDown();
		},

		/**
		 * Callback on mouseup/touchend after mousedown/touchstart on the arrow icon.
		 * Note that this function is called regardless of what node the event occurred on (but only after
		 * a mousedown/touchstart on the arrow).
		 *
		 * If the drop down is a simple menu and the cursor is over the menu, we execute it, otherwise,
		 * we focus our drop down widget.  If the event is missing, then we are not a mouseup event.
		 *
		 * This is useful for the common mouse movement pattern with native browser `<select>` nodes:
		 *
		 * 1. mouse down on the select node (probably on the arrow)
		 * 2. move mouse to a menu item while holding down the mouse button
		 * 3. mouse up; this selects the menu item as though the user had clicked it
		 *
		 * @param {Event} [e]
		 * @private
		 */
		_dropDownPointerUpHandler: function (e) {
			/* jshint maxcomplexity:14 */

			if (this._docHandler) {
				this._docHandler.remove();
				this._docHandler = null;
			}

			// If mousedown on the button, then dropdown opened, then user moved mouse over a menu item
			// in the drop down, and released the mouse.
			if (this._currentDropDown) {
				// This if() statement deals with the corner-case when the drop down covers the original widget,
				// because it's so large.  In that case mouse-up shouldn't select a value from the menu.
				// Find out if our target is somewhere in our dropdown widget,
				// but not over our buttonNode (the clickable node)
				var c = place.position(this.buttonNode);
				if (!(e.pageX >= c.x && e.pageX <= c.x + c.w) || !(e.pageY >= c.y && e.pageY <= c.y + c.h)) {
					var t = e.target, overMenu;
					while (t && !overMenu) {
						if (domClass.contains(t, "d-popup")) {
							overMenu = true;
							break;
						} else {
							t = t.parentNode;
						}
					}
					if (overMenu) {
						if (this._currentDropDown.handleSlideClick) {
							var menuItem = this.getEnclosingWidget(e.target);
							menuItem.handleSlideClick(menuItem, e);
						}
						return;
					}
				}
			}

			if (this._openDropDownPromise) {
				// Focus the drop down once it opens, unless it's a menu.
				// !this.hovering condition checks if this is a fake mouse event caused by the user typing
				// SPACE/ENTER while using JAWS.  Jaws converts the SPACE/ENTER key into mousedown/mouseup events.
				// If this.hovering is false then it's presumably actually a keyboard event.
				this._focusDropDownOnOpen(!this.hovering);
			} else {
				// The drop down arrow icon probably can't receive focus, but widget itself should get focus.
				// defer() needed to make it work on IE (test DateTextBox)
				if (this.focus) {
					this.defer(this.focus);
				}
			}
		},

		/**
		 * Helper function to focus the dropdown when it finishes loading and opening.
		 * Exception: doesn't focus the dropdown when `dropDown.focusOnOpen === false a menu`, unless it
		 * was opened via the keyboard.   `dropDown.focusOnOpen` is meant to be set for menus.
		 * @param {boolean} keyboard - True if the user opened the dropdown via the keyboard
		 */
		_focusDropDownOnOpen: function (keyboard) {
			// Wait until the dropdown appears (if it hasn't appeared already), and then
			// focus it, unless it's a menu (in which case focusOnOpen is set to false).
			// Even if it's a menu, we need to focus it when it's opened by the keyboard.
			this._openDropDownPromise.then(function (ret) {
				var dropDown = ret.dropDown;
				if (dropDown.focus && (keyboard || dropDown.focusOnOpen !== false)) {
					this._focusDropDownTimer = this.defer(function () {
						dropDown.focus();
						delete this._focusDropDownTimer;
					});
				}
			}.bind(this));
		},

		postRender: function () {
			this.buttonNode = this.buttonNode || this.focusNode || this;
			this.popupStateNode = this.popupStateNode || this.focusNode || this.buttonNode;

			this.setAttribute("aria-haspopup", "true");

			// basic listeners
			this.on("pointerdown", this._dropDownPointerDownHandler.bind(this), this.buttonNode);
			this.on("keydown", this._dropDownKeyDownHandler.bind(this), this.focusNode || this);
			this.on("keyup", this._dropDownKeyUpHandler.bind(this), this.focusNode || this);

			// set this.hovering when mouse is over widget so we can differentiate real mouse clicks from synthetic
			// mouse clicks generated from JAWS upon keyboard events
			this.on("pointerenter", function () {
				this.hovering = true;
			}.bind(this));
			this.on("pointerleave", function () {
				this.hovering = false;
			}.bind(this));

			// Avoid phantom click on android [and maybe iOS] where touching the button opens a centered dialog, but
			// then there's a phantom click event on the dialog itself, possibly closing it.
			// Happens in deliteful/tests/functional/ComboBox-prog.html on a phone (portrait mode), when you click
			// towards the right side of the second ComboBox.
			this.on("touchstart", function (evt) {
				// Note: need to be careful not to call evt.preventDefault() indiscriminately because that would
				// prevent [non-disabled] <input> etc. controls from getting focus.
				if (this.dropDownPosition[0] === "center") {
					evt.preventDefault();
				}
			}.bind(this), this.buttonNode);

			// Stop click events and workaround problem on iOS where a blur event occurs ~300ms after
			// the focus event, causing the dropdown to open then immediately close.
			// Workaround iOS problem where clicking a Menu can focus an <input> (or click a button) behind it.
			// Need to be careful though that you can still focus <input>'s and click <button>'s in a TooltipDialog.
			// Also, be careful not to break (native) scrolling of dropdown like ComboBox's options list.
			this.on("touchend", function (evt) {
				evt.preventDefault();
			}, this.buttonNode);
			this.on("click", function (evt) {
				evt.preventDefault();
				evt.stopPropagation();
			}, this.buttonNode);

			this.on("delite-deactivated", this._deactivatedHandler.bind(this));

			// trigger initial setting of d-down-arrow class
			this.notifyCurrentValue("dropDownPosition");
		},

		refreshRendering: function (props) {
			if ("dropDownPosition" in props) {
				// Add a "d-down-arrow" type class to buttonNode so theme can set direction of arrow
				// based on where drop down will normally appear
				var defaultPos = {
					"after": this.isLeftToRight() ? "right" : "left",
					"before": this.isLeftToRight() ? "left" : "right"
				}[this.dropDownPosition[0]] || this.dropDownPosition[0] || "down";

				this.setClassComponent("arrowDirectionIcon", "d-" + defaultPos + "-arrow",
						this.arrowWrapperNode || this.buttonNode);
			}
		},

		destroy: function () {
			// If dropdown is open, close it, to avoid leaving delite/activationTracker in a strange state.
			// Put focus back on me to avoid the focused node getting destroyed, which flummoxes IE.
			if (this.opened) {
				this.closeDropDown(true);
			}

			if (this.dropDown) {
				// Destroy the drop down, unless it's already been destroyed.  This can happen because
				// the drop down is a direct child of <body> even though it's logically my child.
				if (!this.dropDown._destroyed) {
					this.dropDown.destroy();
				}
				delete this.dropDown;
			}
		},

		/**
		 * Callback when the user presses a key while focused on the button node.
		 * @param {Event} e
		 * @private
		 */
		_dropDownKeyDownHandler: function (e) {
			/* jshint maxcomplexity:14 */

			if (this.disabled || this.readOnly) {
				return;
			}
			var dropDown = this._currentDropDown, target = e.target;
			if (dropDown && this.opened) {
				if (dropDown.emit("keydown", e) === false) {
					/* false return code means that the drop down handled the key */
					e.stopPropagation();
					e.preventDefault();
					return;
				}
			}
			if (dropDown && this.opened && e.keyCode === keys.ESCAPE) {
				this.closeDropDown();
				e.stopPropagation();
				e.preventDefault();
			} else if (!this.opened &&
				(e.keyCode === keys.DOWN_ARROW ||
					// ignore unmodified SPACE if KeyNav has search in progress
					((e.keyCode === keys.ENTER || (e.keyCode === keys.SPACE &&
						(!this._searchTimer || (e.ctrlKey || e.altKey || e.metaKey)))) &&
						//ignore enter and space if the event is for a text input
						((target.tagName || "").toLowerCase() !== "input" ||
							(target.type && target.type.toLowerCase() !== "text"))))) {
				// Toggle the drop down, but wait until keyup so that the drop down doesn't
				// get a stray keyup event, or in the case of key-repeat (because user held
				// down key for too long), stray keydown events.
				this._openOnKeyUp = true;
				e.stopPropagation();
				e.preventDefault();
			}
		},

		/**
		 * Callback when the user releases a key while focused on the button node.
		 * @param {Event} e
		 * @private
		 */
		_dropDownKeyUpHandler: function () {
			if (this._openOnKeyUp) {
				delete this._openOnKeyUp;
				this.openDropDown();
				this._focusDropDownOnOpen(true);
			}
		},

		_deactivatedHandler: function () {
			// Called when focus has shifted away from this widget and it's dropdown

			// Close dropdown but don't focus my <input>.  User may have focused somewhere else (ex: clicked another
			// input), and even if they just clicked a blank area of the screen, focusing my <input> will unwantedly
			// popup the keyboard on mobile.
			this.closeDropDown(false);
		},

		/**
		 * Creates/loads the drop down.
		 * Returns a Promise for the dropdown, or if loaded synchronously, the dropdown itself.
		 *
		 * Applications must either:
		 *
		 * 1. set the `dropDown` property to point to the dropdown (as an initialisation parameter)
		 * 2. override this method to create custom drop downs on the fly, returning a reference or promise
		 *    for the dropdown
		 * 3. listen for a "delite-display-load" event, and then [asynchronously] resolve the event's `evt.loadDeferred`
		 *    Promise property with an Object like `{child: dropDown}`
		 *
		 * With option (2) or (3) the application is responsible for destroying the dropdown.
		 *
		 * @returns {Element|Promise} Element or Promise for the dropdown
		 * @protected
		 */
		loadDropDown: function () {
			if (this.dropDown) {
				return this.dropDown;
			} else {
				// tell app controller we are going to show the dropdown; it must return a pointer to the dropdown
				/**
				 * Dispatched if `HasDropDown#dropDown` is undefined, to let an application level listener create the
				 * dropdown node.
				 * @example
				 * document.addEventListener("delite-display-load", function (evt) {
				 *   if (evt.target.id === "dropdown_button_1") {
				 *      evt.loadDeferred.resolve({child: new MyDropDown1({...})});
				 *   }
				 *   ...
				 * }
				 * @event module:delite/HasDropDown#delite-display-load
				 * @property {Promise} loadDeferred - promise to resolve with the dropdown element
				 */
				var def = new Deferred();
				this.emit("delite-display-load", {
					loadDeferred: def
				});
				return def.then(function (value) { return value.child; });
			}
		},

		/**
		 * Toggle the drop-down widget; if it is open, close it, if not, open it.
		 * Called when the user presses the down arrow button or presses
		 * the down arrow key to open/close the drop down.
		 * @protected
		 */
		toggleDropDown: function () {
			if (this.disabled || this.readOnly) {
				return;
			}
			if (!this.opened) {
				return this.openDropDown();
			} else {
				return this.closeDropDown(true);	// refocus button to avoid hiding node w/focus
			}
		},

		/**
		 * Creates the drop down if it doesn't exist, loads the data
		 * if there's an href and it hasn't been loaded yet, and
		 * then opens the drop down.  This is basically a callback when the
		 * user presses the down arrow button to open the drop down.
		 * @returns {Promise} Promise for the drop down widget that fires when drop down is created and loaded.
		 * @protected
		 */
		openDropDown: function () {
			return this._openDropDownPromise ||
				(this._openDropDownPromise = when(this.loadDropDown()).then(function (dropDown) {
				this._currentDropDown = dropDown;
				var aroundNode = this.aroundNode || this,
					self = this;

				/**
				 * Dispatched before popup widget is shown.
				 * @example
				 * document.addEventListener("delite-before-show", function (evt) {
				 *      console.log("about to show popup", evt.child);
				 * });
				 * @event module:delite/HasDropDown#delite-before-show
				 * @property {Element} child - reference to popup
				 */
				this.emit("delite-before-show", {
					child: dropDown,
					cancelable: false
				});

				// Generate id for anchor if it's not already specified
				if (!this.id) {
					this.id = "HasDropDown_" + this.widgetId;
				}

				dropDown._originalStyle = dropDown.style.cssText;

				var retVal = popup.open({
					parent: this,
					popup: dropDown,
					around: aroundNode,
					orient: this.dropDownPosition,
					maxHeight: this.maxHeight,
					onExecute: function () {
						self.closeDropDown(true);
					},
					onCancel: function () {
						self.closeDropDown(true);
					},
					onClose: function () {
						domClass.remove(self.popupStateNode, "d-drop-down-open");
						this.opened = false;
					}
				});

				// Set width of drop down if necessary, so that dropdown width + width of scrollbar (from popup wrapper)
				// matches width of aroundNode.  Don't do anything for when dropDownPosition=["center"] though,
				// in which case popup.open() doesn't return a value.
				if (retVal && (this.forceWidth ||
						(this.autoWidth && aroundNode.offsetWidth > dropDown._popupWrapper.offsetWidth))) {
					var widthAdjust = aroundNode.offsetWidth - dropDown._popupWrapper.offsetWidth;
					dropDown._popupWrapper.style.width = aroundNode.offsetWidth + "px";

					// Workaround apparent iOS bug where width: inherit on dropdown apparently not working.
					dropDown.style.width = aroundNode.offsetWidth + "px";

					// If dropdown is right-aligned then compensate for width change by changing horizontal position
					if (retVal.corner[1] === "R") {
						dropDown._popupWrapper.style.left =
							(dropDown._popupWrapper.style.left.replace("px", "") - widthAdjust) + "px";
					}
				}

				domClass.add(this.popupStateNode, "d-drop-down-open");
				this.opened = true;

				this.popupStateNode.setAttribute("aria-expanded", "true");
				this.popupStateNode.setAttribute("aria-owns", dropDown.id);

				// Set aria-labelledby on dropdown if it's not already set to something more meaningful
				if (dropDown.getAttribute("role") !== "presentation" && !dropDown.getAttribute("aria-labelledby")) {
					dropDown.setAttribute("aria-labelledby", this.id);
				}

				/**
				 * Dispatched after popup widget is shown.
				 * @example
				 * document.addEventListener("delite-after-show", function (evt) {
				 *      console.log("just displayed popup", evt.child);
				 * });
				 * @event module:delite/HasDropDown#delite-after-show
				 * @property {Element} child - reference to popup
				 */
				this.emit("delite-after-show", {
					child: dropDown,
					cancelable: false
				});

				return {
					dropDown: dropDown,
					position: retVal
				};
			}.bind(this)));
		},

		/**
		 * Closes the drop down on this widget.
		 * @param {boolean} focus - If true, refocus this widget.
		 * @protected
		 */
		closeDropDown: function (focus) {
			if (this._openDropDownPromise) {
				if (!this._openDropDownPromise.isFulfilled()) {
					this._openDropDownPromise.cancel();
				}
				delete this._openDropDownPromise;
			}

			if (this._focusDropDownTimer) {
				this._focusDropDownTimer.remove();
				delete this._focusDropDownTimer;
			}

			if (this.opened) {
				this.popupStateNode.setAttribute("aria-expanded", "false");
				if (focus && this.focus) {
					this.focus();
				}

				/**
				 * Dispatched before popup widget is hidden.
				 * @example
				 * document.addEventListener("delite-before-hide", function (evt) {
				 *      console.log("about to hide popup", evt.child);
				 * });
				 * @event module:delite/HasDropDown#delite-before-hide
				 * @property {Element} child - reference to popup
				 */
				this.emit("delite-before-hide", {
					child: this._currentDropDown,
					cancelable: false
				});

				popup.close(this._currentDropDown);
				this.opened = false;

				this._currentDropDown.style.cssText = this._currentDropDown._originalStyle;

				/**
				 * Dispatched after popup widget is hidden.
				 * @example
				 * document.addEventListener("delite-after-hide", function (evt) {
				 *      console.log("just hid popup", evt.child);
				 * });
				 * @event module:delite/HasDropDown#delite-after-hide
				 * @property {Element} child - reference to popup
				 */
				this.emit("delite-after-hide", {
					child: this._currentDropDown,
					cancelable: false
				});
			}

			delete this._currentDropDown;
		}
	});
});
