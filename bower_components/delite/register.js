/** @module delite/register */
define([
	"dcl/dcl",
	"./features"
], function (dcl, has) {
	"use strict";

	var doc = typeof document !== "undefined" && document;	// "typeof document" check so module loads in NodeJS

	// Workaround problem using dcl() on native DOMNodes on FF and IE,
	// see https://github.com/uhop/dcl/issues/9.
	// Fixes case where tabIndex is declared in a mixin that's passed to register().
	dcl.mix = function (a, b) {
		for (var n in b) {
			try {
				a[n] = b[n];
			} catch (e) {
				Object.defineProperty(a, n, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: b[n]
				});
			}
		}
	};

	/**
	 * List of selectors that the parser needs to search for as possible upgrade targets.  Mainly contains
	 * the widget custom tags like d-accordion, but also selectors like button[is='d-button'] to find <button is="...">
	 * @type {string[]}
	 */
	var selectors = [];

	/**
	 * Internal registry of widget class metadata.
	 * Key is custom widget tag name, used as Element tag name like <d-accordion> or "is" attribute like
	 * <button is="d-accordion">).
	 * Value is metadata about the widget, including its prototype, ex: {prototype: object, extends: "button", ... }
	 * @type {Object}
	 */
	var registry = {};

	/**
	 * Create an Element.  Similar to document.createElement(), but if tag is the name of a widget defined by
	 * register(), then it upgrades the Element to be a widget.
	 * @function module:delite/register.createElement
	 * @param {string} tag
	 * @returns {Element} The DOMNode
	 */
	function createElement(tag) {
		var base = registry[tag] ? registry[tag].extends : null;
		if (has("document-register-element")) {
			return base ? doc.createElement(base, tag) : doc.createElement(tag);
		} else {
			var element = doc.createElement(base || tag);
			if (base) {
				element.setAttribute("is", tag);
			}
			upgrade(element);
			return element;
		}
	}

	/**
	 * Generate metadata about all the properties in proto, both direct and inherited.
	 * On IE<=10, these properties will be applied to a DOMNode via Object.defineProperties().
	 * Skips properties in the base element (HTMLElement, HTMLButtonElement, etc.)
	 * @param {Object} proto - The prototype.
	 * @returns {Object} Hash from property name to return value from `Object.getOwnPropertyDescriptor()`.
	 */
	function getPropDescriptors(proto) {
		var props = {};

		do {
			var keys = Object.getOwnPropertyNames(proto);	// better than Object.keys() because finds hidden props too
			for (var i = 0, k; (k = keys[i]); i++) {
				if (!props[k]) {
					props[k] = Object.getOwnPropertyDescriptor(proto, k);
				}
			}
			proto = Object.getPrototypeOf(proto);
		} while (!/HTML[a-zA-Z]*Element/.test(proto.constructor.toString()));

		return props;
	}

	/**
	 * Converts plain DOMNode of custom type into widget, by adding the widget's custom methods, etc.
	 * Does nothing if the DOMNode has already been converted or if it doesn't correspond to a custom widget.
	 * Roughly equivalent to dojo/parser::instantiate(), but for a single node, not an array
	 * @function module:delite/register.upgrade
	 * @param {Element} inElement The DOM node.
	 */
	function upgrade(element) {
		if (!has("document-register-element") &&
				/*jshint camelcase: false*/ !element.__upgraded__/*jshint camelcase: true*/) {
			var widget = registry[element.getAttribute("is") || element.nodeName.toLowerCase()];
			if (widget) {
				if (has("dom-proto-set")) {
					// Redefine Element's prototype to point to widget's methods etc.
					/*jshint camelcase: false*/
					/*jshint proto: true*/
					element.__proto__ = widget.prototype;
					/*jshint camelcase: true*/
					/*jshint proto: false*/
				} else {
					// Mixin all the widget's methods etc. into Element
					Object.defineProperties(element, widget.props);
				}
				/*jshint camelcase: false*/
				element.__upgraded__ = true;
				/*jshint camelcase: true*/
				if (element.createdCallback) {
					element.createdCallback();
				}
				if (element.attachedCallback && doc.documentElement.contains(element)) {
					// Note: if app inserts an element manually it needs to call attachedCallback() manually
					element.attachedCallback();
				}
			}
		}
	}

	/**
	 * Mapping of tag names to HTMLElement interfaces.
	 * Doesn't include newer elements not available on all browsers.
	 * @type {Object}
	 */
	var tagMap = typeof HTMLElement !== "undefined" && {	// "typeof HTMLElement" check so module loads in NodeJS
		a: HTMLAnchorElement,
		// applet: HTMLAppletElement,
		// area: HTMLAreaElement,
		// audio: HTMLAudioElement,
		base: HTMLBaseElement,
		br: HTMLBRElement,
		button: HTMLButtonElement,
		canvas: HTMLCanvasElement,
		// data: HTMLDataElement,
		// datalist: HTMLDataListElement,
		div: HTMLDivElement,
		dl: HTMLDListElement,
		directory: HTMLDirectoryElement,
		// embed: HTMLEmbedElement,
		fieldset: HTMLFieldSetElement,
		font: HTMLFontElement,
		form: HTMLFormElement,
		head: HTMLHeadElement,
		h1: HTMLHeadingElement,
		html: HTMLHtmlElement,
		hr: HTMLHRElement,
		iframe: HTMLIFrameElement,
		img: HTMLImageElement,
		input: HTMLInputElement,
		// keygen: HTMLKeygenElement,
		label: HTMLLabelElement,
		legend: HTMLLegendElement,
		li: HTMLLIElement,
		link: HTMLLinkElement,
		map: HTMLMapElement,
		// media: HTMLMediaElement,
		menu: HTMLMenuElement,
		meta: HTMLMetaElement,
		// meter: HTMLMeterElement,
		ins: HTMLModElement,
		object: HTMLObjectElement,
		ol: HTMLOListElement,
		optgroup: HTMLOptGroupElement,
		option: HTMLOptionElement,
		// output: HTMLOutputElement,
		p: HTMLParagraphElement,
		param: HTMLParamElement,
		pre: HTMLPreElement,
		// progress: HTMLProgressElement,
		quote: HTMLQuoteElement,
		script: HTMLScriptElement,
		select: HTMLSelectElement,
		// source: HTMLSourceElement,
		// span: HTMLSpanElement,
		style: HTMLStyleElement,
		table: HTMLTableElement,
		caption: HTMLTableCaptionElement,
		// td: HTMLTableDataCellElement,
		// th: HTMLTableHeaderCellElement,
		col: HTMLTableColElement,
		tr: HTMLTableRowElement,
		tbody: HTMLTableSectionElement,
		textarea: HTMLTextAreaElement,
		// time: HTMLTimeElement,
		title: HTMLTitleElement,
		// track: HTMLTrackElement,
		ul: HTMLUListElement,
		// blink: HTMLUnknownElement,
		video: HTMLVideoElement
	};
	var tags = tagMap && Object.keys(tagMap);

	/**
	 * Registers the tag with the current document, and save tag information in registry.
	 * Handles situations where the base constructor inherits from
	 * HTMLElement but is not HTMLElement.
	 * @param  {string}   tag         The custom tag name for the element, or the "is" attribute value.
	 * @param  {string}   baseElement The native HTML*Element "class" that this custom element is extending.
	 * @param  {Function} baseCtor    The constructor function.
	 * @return {Function}             The "new" constructor function that can create instances of the custom element.
	 */
	function getTagConstructor(tag, baseElement, baseCtor) {
		var proto = baseCtor.prototype,
			config = registry[tag] = {
				constructor: baseCtor,
				prototype: proto
			};
		if (baseElement !== HTMLElement) {
			config.extends = tags.filter(function (tag) {
				return tagMap[tag] === baseElement;
			})[0];
			if (!config.extends) {
				throw new TypeError(tag + ": must have HTMLElement in prototype chain");
			}
		}

		if (has("document-register-element")) {
			doc.registerElement(tag, config);
		} else {
			if (!has("dom-proto-set")) {
				// Get descriptors for all the properties in the prototype.  This is needed on IE<=10 in upgrade().
				config.props = getPropDescriptors(proto);
			}
		}

		// Register the selector to find this custom element
		selectors.push(config.extends ? config.extends + "[is='" + tag + "']" : tag);

		// Note: if we wanted to support registering new types after the parser was called, then here we should
		// scan the document for the new type (selectors[length-1]) and upgrade any nodes found.

		// Create a constructor method to return a DOMNode representing this widget.
		var tagConstructor = function (params, srcNodeRef) {
			// Create new widget node or upgrade existing node to widget
			var node;
			if (srcNodeRef) {
				node = typeof srcNodeRef === "string" ? doc.getElementById(srcNodeRef) : srcNodeRef;
				upgrade(node);
			} else {
				node = createElement(tag);
			}

			// Set parameters on node
			for (var name in params || {}) {
				if (name === "style") {
					node.style.cssText = params.style;
				} else if ((name === "class" || name === "className") && node.setClassComponent) {
					node.setClassComponent("user", params[name]);
				} else {
					node[name] = params[name];
				}
			}

			return node;
		};

		// Add some flags for debugging and return the new constructor
		tagConstructor.tag = tag;
		tagConstructor._ctor = baseCtor;

		return tagConstructor;
	}

	/**
	 * Restore the "true" constructor when trying to recombine custom elements
	 * @param  {Function} extension A constructor function that might have a shadow property that contains the
	 *                              original constructor
	 * @return {Function}           The original construction function or the existing function/object
	 */
	function restore(extension) {
		return (extension && extension._ctor) || extension;
	}

	/**
	 * Declare a widget and register it as a custom element.
	 *
	 * props{} can provide custom setters/getters for widget properties, which are called automatically when
	 * the widget properties are set.
	 * For a property XXX, define methods _setXXXAttr() and/or _getXXXAttr().
	 *
	 * @param  {string}               tag             The custom element's tag name.
	 * @param  {Object[]}             superclasses    Any number of superclasses to be built into the custom element
	 *                                                constructor. But first one must be [descendant] of HTMLElement.
	 * @param  {Object}               props           Properties of this widget class.
	 * @return {Function}                             A constructor function that will create an instance of the custom
	 *                                                element.
	 * @function module:delite/register
	 */
	function register(tag, superclasses, props) {
		// Create the widget class by extending specified superclasses and adding specified properties.

		// Make sure all the bases have their proper constructors for being composited.
		// I.E. remove the wrapper added by getTagConstructor().
		var bases = (superclasses instanceof Array ? superclasses : superclasses ? [superclasses] : []).map(restore);


		// Check to see if the custom tag is already registered
		if (tag in registry) {
			throw new TypeError("A widget is already registered with tag '" + tag + "'.");
		}

		// Get root (aka native) class: HTMLElement, HTMLInputElement, etc.
		var baseElement = bases[0];
		if (baseElement.prototype && baseElement.prototype._baseElement) {
			// The first superclass is a widget created by another call to register, so get that widget's root class
			baseElement = baseElement.prototype._baseElement;
		}

		// Get a composited constructor
		var ctor = dcl(bases, props || {}),
			proto = ctor.prototype;
		proto._ctor = ctor;
		proto._baseElement = baseElement;

		// Run introspection to add ES5 getters/setters.
		// Doesn't happen automatically because Stateful's constructor isn't called.
		// Also, on IE this needs to happen before the getTagConstructor() call,
		// since getTagConstructor() scans all the properties on the widget prototype.
		if (proto._introspect) {
			ctor._propsToObserve = proto._getProps();
			proto._introspect(ctor._propsToObserve);
			ctor._introspected = true;
		}

		// Save widget metadata to the registry and return constructor that creates an upgraded DOMNode for the widget
		/* jshint boss:true */
		return getTagConstructor(tag, baseElement, ctor);
	}

	/**
	 * Parse the given DOM tree for any DOMNodes that need to be upgraded to widgets.
	 * @function module:delite/register.parse
	 * @param {Element} [root] DOM node to parse from.
	 */
	function parse(root) {
		// Note: if() statement to avoid calling querySelectorAll(""), which fails on Chrome.
		if (selectors.length) {
			// Note that upgrade() will be a no-op when has("document-register-element") is true, but we still
			// need to calculate nodes[] for the startup() call below.
			var node, idx = 0, nodes = (root || doc).querySelectorAll(selectors.join(", "));
			while ((node = nodes[idx++])) {
				upgrade(node);
			}

			// Call startup() on top level nodes.  Since I don't know which nodes are top level,
			// just call startup on all widget nodes.  Most of the calls will be ignored since the nodes
			// have already been started.
			idx = 0;
			while ((node = nodes[idx++])) {
				if (node.startup && !node.started) {
					node.startup();
				}
			}
		}
	}

	// Setup return value as register() method, with other methods hung off it.
	register.upgrade = upgrade;
	register.createElement = createElement;
	register.parse = parse;

	// Add helpers from dcl for declaring classes.

	/**
	 * Convenience shortcut to [dcl()](http://www.dcljs.org/docs/mini_js/dcl/).
	 * @function module:delite/register.dcl
	 */
	register.dcl = dcl;

	/**
	 * Convenience shortcut to [dcl.after()](http://www.dcljs.org/docs/dcl_js/after/).
	 * @function module:delite/register.after
	 */
	register.after = dcl.after;

	/**
	 * Convenience shortcut to [dcl.before()](http://www.dcljs.org/docs/dcl_js/before/).
	 * @function module:delite/register.before
	 */
	register.before = dcl.before;

	/**
	 * Convenience shortcut to [dcl.around()](http://www.dcljs.org/docs/dcl_js/around/).
	 * @function module:delite/register.around
	 */
	register.around = dcl.around;

	/**
	 * Convenience shortcut to [dcl.superCall()](http://www.dcljs.org/docs/mini_js/supercall/).
	 * @function module:delite/register.superCall
	 */
	register.superCall = dcl.superCall;

	return register;
});
