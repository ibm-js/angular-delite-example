/** @module deliteful/Select */
define([
	"dcl/dcl",
	"dojo/dom-class", // TODO: replace (when replacement confirmed)
	"delite/register",
	"delite/FormWidget",
	"delite/StoreMap",
	"delite/Selection",
	"delite/handlebars!./Select/Select.html",
	"delite/theme!./Select/themes/{{theme}}/Select.css"
], function (dcl, domClass, register,
	FormWidget, StoreMap, Selection, template) {

	/**
	 * A form-aware and store-aware widget leveraging the native HTML5 `<select>`
	 * element.
	 * It has the following characteristics:
	 * * The corresponding custom tag is `<d-select>`.
	 * * Store support (limitation: to avoid graphic glitches, the updates to the
	 * store should not be done while the native dropdown of the select is open).
	 * * The item rendering has the limitations of the `<option>` elements of the
	 * native `<select>`, in particular it is text-only.
	 * 
	 * TODO: improve doc.
	 * 
	 * Remarks:
	 * * The option items must be added, removed or updated exclusively using
	 * the store API. Direct operations using the DOM API are not supported.
	 * * The handling of the selected options of the underlying native `<select>`
	 * must be done using the API inherited by deliteful/Select from delite/Selection.
	 * 
	 * @example <caption>Using store custom element in markup</caption>
	 * JS:
	 * require(["delite/register", "deliteful/Select", "requirejs-domready/domReady!"],
	 *   function (register) {
	 *     register.parse();
	 *   });
	 * HTML:
	 * <d-store id="myStore">
	 *    {text: "Option 1", value: "1"}
	 *    ...
	 * </d-store>
	 * <d-select id="select" store="myStore"></d-select>
	 * @example <caption>Using programmatically created store</caption>
	 * JS:
	 * require(["delite/register", "dstore/Memory", "dstore/Trackable",
	 *         "deliteful/Select", "requirejs-domready/domReady!"],
	 *   function (register, Memory, Trackable) {
	 *     register.parse();
	 *     var store = new (Memory.createSubclass(Trackable))({});
	 *     select1.store = store;
	 *     store.add({text: "Option 1", value: "1"});
	 *     ...
	 *   });
	 * HTML:
	 * <d-select selectionMode="multiple" id="select"></d-select>
	 * 
	 * @class module:deliteful/Select
	 * @augments module:delite/FormWidget
	 * @augments module:delite/StoreMap
	 * @augments module:delite/Selection
	 */
	return register("d-select", [HTMLElement, FormWidget, StoreMap, Selection],
		/** @lends module:deliteful/Select# */ {
		
		// Note: the properties `store` and `query` are inherited from delite/Store, and
		// the property `disabled` is inherited from delite/FormWidget.
		
		/**
		 * The number of rows that should be visible at one time when the widget
		 * is presented as a scrollable list box. Corresponds to the `size` attribute
		 * of the underlying native HTML `<select>`.
		 * @member {number}
		 * @default 0
		 */
		size: 0,
		
		/**
		 * The name of the property of store items which contains the text
		 * of Select's options.
		 * @member {string}
		 * @default "text"
		 */
		textAttr: "text",
		
		/**
		 * The name of the property of store items which contains the value
		 * of Select's options.
		 * @member {string}
		 * @default "value"
		 */
		valueAttr: "value",
		
		/**
		 * The name of the property of store items which contains the disabled
		 * value of Select's options. To disable a given option, the `disabled`
		 * property of the corresponding data item must be set to a truthy value.
		 * Otherwise, the option is enabled if data item property is absent, or
		 * its value is falsy or the string "false".
		 * @member {string}
		 * @default "disabled"
		 */
		disabledAttr: "disabled",
		
		baseClass: "d-select",
		
		/**
		 * The chosen selection mode.
		 *
		 * Valid values are:
		 *
		 * 1. "single": Only one option can be selected at a time.
		 * 2. "multiple": Several options can be selected (by taping or using the
		 * control key modifier).
		 *
		 * Changing this value impacts the currently selected items to adapt the
		 * selection to the new mode. However, regardless of the selection mode,
		 * it is always possible to set several selected items using the
		 * `selectedItem` or `selectedItems` properties.
		 * The mode will be enforced only when using `setSelected` and/or
		 * `selectFromEvent` APIs.
		 *
		 * @member {string} module:deliteful/Select#selectionMode
		 * @default "single"
		 */
		// The purpose of the above pseudo-property is to adjust the documentation
		// of selectionMode as provided by delite/Selection.
		  
		template: template,
		
		attachedCallback: function () {
			// To provide graphic feedback for focus, react to focus/blur events
			// on the underlying native select. The CSS class is used instead
			// of the focus pseudo-class because the browsers give the focus
			// to the underlying select, not to the widget.
			this.on("focus", function (evt) {
				domClass.toggle(this, "d-select-focus", evt.type === "focus");
			}.bind(this), this.valueNode);
			this.on("blur", function (evt) {
				domClass.toggle(this, "d-select-focus", evt.type === "focus");
			}.bind(this), this.valueNode);
			
			// Keep delite/Selection's selectedItem/selectedItems in sync after
			// interactive selection of options.
			this.on("change", function (event) {
				var selectedItems = this.selectedItems,
					selectedOptions = this.valueNode.selectedOptions;
				// HTMLSelectElement.selectedOptions is not present in all browsers...
				// At least IE10/Win misses it. Hence:
				if (selectedOptions === undefined) {
					// Convert to array
					var options = Array.prototype.slice.call(this.valueNode.options);
					selectedOptions = options.filter(function (option) {
						return option.selected;
					});
				} else {
					// convert HTMLCollection into array (to be able to use array.indexOf)
					selectedOptions = Array.prototype.slice.call(selectedOptions);
				}
				var nSelectedItems = selectedItems ? selectedItems.length : 0,
					nSelectedOptions = selectedOptions ? selectedOptions.length : 0;
				var i;
				var selectedOption, selectedItem;
				// Identify the options which changed their selection state. Two steps:
				// Step 1. Search options previously selected (currently in widget.selectedItems)
				// which are no longer selected in the native select.
				for (i = 0; i < nSelectedItems; i++) {
					selectedItem = selectedItems[i];
					if (selectedOptions.indexOf(selectedItem.__visualItem) === -1) {
						this.selectFromEvent(event, selectedItem, selectedItem.__visualItem, true);
					}
				}
				// Step 2. Search options newly selected in the native select which are not
				// present in the current selection (widget.selectedItems).
				for (i = 0; i < nSelectedOptions; i++) {
					selectedOption = selectedOptions[i];
					if (selectedItems.indexOf(selectedOption.__dataItem) === - 1) {
						this.selectFromEvent(event, selectedOption.__dataItem, selectedOption, true);
					}
				}
				
				// Update widget's value after interactive selection
				this._set("value", this.valueNode.value);
			}.bind(this), this.valueNode);
			
			// Thanks to the custom getter defined in deliteful/Select for widget's
			// `value` property, there is no need to add code for keeping the
			// property in sync after a form reset.
		},
		
		hasSelectionModifier: function () {
			// Override of the method from delite/Selection because the
			// default implementation is inappropriate: the "change" event
			// has no key modifier.
			return this.selectionMode === "multiple";
		},
		
		refreshRendering: function (props) {
			if ("renderItems" in props) {
				// Populate the select with the items retrieved from the store.
				var renderItems = this.renderItems;
				var n = renderItems ? renderItems.length : 0;
				// TODO: CHECKME/IMPROVEME. Also called after adding, deleting or updating just one item.
				// Worth optimizing to avoid recreating from scratch?
				this.valueNode.innerHTML = ""; // Remove the existing options from the DOM
				if (n > 0) {
					var fragment = this.ownerDocument.createDocumentFragment();
					var renderItem, option;
					for (var i = 0; i < n; i++) {
						renderItem = renderItems[i];
						option = this.ownerDocument.createElement("option");
						// to allow retrieving the data item from the option element
						option.__dataItem = renderItem.__item; // __item is set by StoreMap.itemToRenderItem()
						// to allow retrieving the option element from widget's selectedItems
						// (which are data items, not render items).
						option.__dataItem.__visualItem = option;
						
						// According to http://www.w3.org/TR/html5/forms.html#the-option-element, we 
						// could use equivalently the label or the text IDL attribute of the option element.
						// However, using the label attr. breaks the rendering in FF29/Win7!
						// This is https://bugzilla.mozilla.org/show_bug.cgi?id=40545.
						// Hence don't do
						// option.label = renderItem.label;
						// Instead:
						if (renderItem.text !== undefined) { // optional
							option.text = renderItem.text;
						}
						if (renderItem.value !== undefined) { // optional
							option.setAttribute("value", renderItem.value);
						}
						// The selection API (delite/Selection) needs to be called consistently
						// for data items, not for render items.
						// renderItem.__item is the data item instance for which
						// StoreMap.itemToRenderItem() has created the render item.
						// For now there is no public API for accessing it.
						if (this.isSelected(renderItem.__item)) { // delite/Selection's API
							option.setAttribute("selected", "true");
						}
						if (renderItem.disabled !== undefined &&
							!!renderItem.disabled && renderItem.disabled !== "false") { // optional
							// Note that for an enabled option the attribute must NOT be set
							// (<option disabled="false"> is a disabled option!)
							option.setAttribute("disabled", "true");
						}
						
						fragment.appendChild(option);
					}
					this.valueNode.appendChild(fragment);
					
					if (this.selectionMode === "single") {
						// Since there is no native "change" event initially, initialize
						// the delite/Selection's selectedItem property with the currently
						// selected option of the native select.
						this.selectedItem =
							this.valueNode.options[this.valueNode.selectedIndex].__dataItem;
					} // else for the native multi-select: it does not have any
					// option selected by default.
					
					// Initialize widget's value
					this._set("value", this.valueNode.value);
				}
			}
		},
		
		getIdentity: function (dataItem) {
			// Override of delite/Selection's method
			return this.store.getIdentity(dataItem);
		},
		
		updateRenderers: function () {
			// Override of delite/Selection's method
			// Trigger rerendering from scratch:
			this.notifyCurrentValue("renderItems");
		},
		
		_setValueAttr: function (value) {
			if (this.valueNode) {
				this.valueNode.value = value;
			}
			this._set("value", value);
		},
		
		_setSelectionModeAttr: dcl.superCall(function (sup) {
			// Override of the setter from delite/Selection to forbid the values
			// "none" and "radio"
			return function (value) {
				if (value !== "single" && value !== "multiple") {
					throw new TypeError("'" + value +
						"' not supported for selectionMode; keeping the previous value of '" +
						this.selectionMode + "'");
				} else {
					this._set("selectionMode", value);
				}
				sup.call(this, value);
			};
		})
	});
});
