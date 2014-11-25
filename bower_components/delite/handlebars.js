/**
 * Plugin that loads a handlebars template from a specified MID and returns a function to
 * generate DOM corresponding to that template.
 *
 * When that function is run, it returns another function,
 * meant to be run when the widget properties change.  The returned function will update the
 * DOM corresponding to the widget property changes.
 *
 * Both functions are meant
 * to be run in the context of the widget, so that properties are available through `this`.
 *
 * Could also theoretically be used by a build-tool to precompile templates, assuming you loaded
 * [jsdom](https://github.com/tmpvar/jsdom) to provide methods like `document.createElement()`.
 *
 * Template has a format like:
 *
 * ```html
 * <button>
 *   <span class="d-reset {{iconClass}}"></span>
 *   {{label}}
 * </button>
 * ```
 *
 * Usage is typically like:
 *
 * ```js
 * define([..., "delite/handlebars!./templates/MyTemplate.html"], function(..., template){
 *     ...
 *     template: template,
 *     ...
 * });
 * ```
 *
 * @module delite/handlebars
 */
define(["./Template", "require"], function (Template, require) {

	// Text plugin to load the templates and do the build.
	var textPlugin = "requirejs-text/text";

	/**
	 * Given a string like "hello {{foo}} world", generate JS code to output that string,
	 * ex: "hello" + this.foo + "world", and also get list of properties that we need to watch for changes.
	 * @param {string} text
	 * @param {boolean} convertUndefinedToBlank - Useful so that class="foo {{item.bar}}" will convert to class="foo"
	 * rather than class="foo undefined", but for something like aria-valuenow="{{value}}", when value is undefined
	 * we need to leave it that way, to trigger removal of that attribute completely instead of setting
	 * aria-valuenow="".
	 * @returns {Object} Object like {expr: "'hello' + this.foo + 'world'", dependsOn: ["foo"]}
	 */
	function toJs(text, convertUndefinedToBlank) {
		var inVar, parts = [], wp = {};

		(text || "").split(/({{|}})/).forEach(function (str) {
			if (str === "{{") {
				inVar = true;
			} else if (str === "}}") {
				inVar = false;
			} else if (inVar) {
				// it's a property or a JS expression
				var prop = str.trim();
				if (/this\./.test(prop)) {
					// JS expression (ex: this.selectionMode === "multiple")
					parts.push("(" + str + ")");
					str.match(/this\.(\w+)/g).forEach(function (thisVar) {
						wp[thisVar.substring(5)] = true;	// "this.foo" --> "foo"
					});
				} else {
					// Property (ex: selectionMode) or path (ex: item.foo)
					wp[prop.replace(/[^\w].*/, "")] = true; // If nested prop (item.foo), watch top level prop (item).
					parts.push(convertUndefinedToBlank ? "(this." + prop + " || '')" : "this." + prop);
				}
			} else if (str) {
				// string literal, single quote it and escape special characters
				parts.push("'" +
					str.replace(/(['\\])/g, "\\$1").replace(/\n/g, "\\n").replace(/\t/g, "\\t") + "'");
			}
		});

		return {
			expr: parts.join(" + "),
			dependsOn: Object.keys(wp)
		};
	}

	var handlebars = /** @lends module:delite/handlebars */ {
		/**
		 * Given a template in DOM, returns the Object tree representing that template.
		 * @param {Element} templateNode - Root node of template.
		 * @param {string} [xmlns] - Used primarily for SVG nodes.
		 * @returns {Object} Object in format
		 * `{tag: string, xmlns: string, attributes: {}, children: Object[], attachPoints: string[]}`.
		 * @private
		 */
		parse: function (templateNode, xmlns) {
			/* jshint maxcomplexity:13 */
			// Get tag name, reversing the tag renaming done in parse()
			var tag = templateNode.hasAttribute("is") ? templateNode.getAttribute("is") :
					templateNode.tagName.replace(/^template-/i, "").toLowerCase(),
				elem = Template.getElement(tag);

			// Process attributes
			var attributes = {}, connects = {}, attachPoints;
			var i = 0, item, attrs = templateNode.attributes;
			for (i = 0; (item = attrs[i]); i++) {
				if (item.value) {
					switch (item.name) {
					case "xmlns":
						xmlns = item.value;
						break;
					case "is":
						// already handled above
						break;
					case "attach-point":
					case "data-attach-point":		// in case user wants to use HTML validator
						attachPoints = item.value.split(/, */);
						break;
					default:
						if (/^on-/.test(item.name)) {
							// on-click="{{handlerMethod}}" sets connects.click = "handlerMethod"
							connects[item.name.substring(3)] = item.value.replace(/\s*({{|}})\s*/g, "");
						} else {
							// map x="hello {{foo}} world" --> "hello " + this.foo + " world";
							var propName = Template.getProp(tag, item.name);
							if (propName && typeof elem[propName] !== "string" &&
								!/{{/.test(item.value) && propName !== "style.cssText") {
								// This attribute corresponds to a non-string property, and the value specified is a
								// literal like vertical="false", so *don't* convert value to string.
								var value = item.value;
								if (typeof elem[propName] === "boolean" && (value === "off" || value === "on")) {
									// conversion code needed on iOS for autocorrect property
									value = value === "on" ? "true" : "false";
								}
								attributes[item.name] = {
									expr: value,
									dependsOn: []
								};
							} else {
								attributes[item.name] = toJs(item.value, item.name === "class");
							}
						}
					}
				}
			}

			return {
				tag: tag,
				xmlns: xmlns,
				attributes: attributes,
				connects: connects,
				children: handlebars.parseChildren(templateNode, xmlns),
				attachPoints: attachPoints
			};
		},

		/**
		 * Scan child nodes, both text and Elements.
		 * @param {Element} templateNode
		 * @param {string} [xmlns] - Used primarily for SVG nodes.
		 * @returns {Array}
		 * @private
		 */
		parseChildren: function (templateNode, xmlns) {
			var children = [];

			// Index of most recent non-whitespace node added to children array
			var lastRealNode;

			// Scan all the children, populating children[] array.
			// Trims starting and ending whitespace nodes, but not whitespace in the middle, so that
			// the following example only ends up with one whitespace node between hello and world:
			//
			// <div>\n\t<span>hello</span> <span>world</span>\n</div>
			for (var child = templateNode.firstChild; child; child = child.nextSibling) {
				var childType = child.nodeType;
				if (childType === 1) {
					// Standard DOM node, recurse
					lastRealNode = children.length;
					children.push(handlebars.parse(child, xmlns));
				} else if (childType === 3) {
					// Text node likely containing variables like {{foo}}.
					if (/^[ \t\n]*$/.test(child.nodeValue)) {
						// Whitespace node.  Note: avoided using trim() since that removes &nbsp; nodes.
						if (lastRealNode === undefined) {
							// Skip leading whitespace nodes
							continue;
						}
					} else {
						lastRealNode = children.length;
					}
					children.push(toJs(child.nodeValue, true));
				}
			}

			return children.slice(0, lastRealNode + 1); // slice() removes trailing whitespace nodes
		},


		/**
		 * Given a template string, returns the DOM tree representing that template.
		 * Will only run in a browser, or in node.js with https://github.com/tmpvar/jsdom.
		 * @param {string} templateText - HTML text for template.
		 * @returns {Element} Root element of tree
		 * @private
		 */
		toDom: function (templateText) {
			// Rename all the elements in the template so that:
			// 1. browsers with native document.createElement() support don't start instantiating custom elements
			//    in the template, creating internal nodes etc.
			// 2. prevent <select size={{size}}> from converting to <select size=0> on webkit
			// 3. prevent <img src={{foo}}> from starting an XHR for a URL called {{foo}} (webkit, maybe other browsers)
			// Regex will not match <!-- comment -->.
			templateText = templateText.replace(
				/(<\/? *)([-a-zA-Z0-9]+)/g, "$1template-$2");

			// For self-closing tags like <input> that have been converted to <template-input>, we need to add a
			// closing </template-input> tag.
			templateText = templateText.replace(
				/* jshint maxlen:200 */
				/<template-(area|base|br|col|command|embed|hr|img|input|keygen|link|meta|param|source|track|wbr)([^>]*)\/?>/g,
				"<template-$1$2></template-$1>");

			// Create DOM tree from template.
			// If template contains SVG nodes then parse as XML, to preserve case of attributes like viewBox.
			// Otherwise parse as HTML, to allow for missing closing tags, ex: <ul> <li>1 <li>2 </ul>.
			var root;
			if (/<template-svg/.test(templateText)) {
				var parser = new DOMParser();
				root = parser.parseFromString(templateText, "text/xml").firstChild;
				while (root.nodeType !== 1) {
					// Skip top level comment and move to "real" template root node.
					// Needed since there's no .firstElementChild or .nextElementSibling for SVG nodes on FF.
					root = root.nextSibling;
				}
			} else {
				// Use innerHTML because Safari doesn't support DOMParser.parseFromString(str, "text/html")
				var container = document.createElement("div");
				container.innerHTML = templateText;
				root = container.firstElementChild; // use .firstElementChild to skip possible top level comment
			}

			return root;
		},

		/**
		 * Given a template, returns a function to generate DOM corresponding to that template,
		 * and setup listeners (using `Stateful#observe()`) to propagate changes in the widget
		 * properties to the templates.
		 *
		 * This method is usually only called directly when your template contains custom elements,
		 * and a call to handlebars!myTemplate.html might try to compile the template before the custom
		 * elements were loaded.
		 *
		 * @param {string} template - See module description for details on template format.
		 * @returns {Function} - Function that optionally takes a top level node, or creates it if not passed in, and
		 * then creates the rest of the DOMNodes in the template.
		 */
		compile: function (templateText) {
			var templateDom = handlebars.toDom(templateText);
			var tree = handlebars.parse(templateDom);
			var template = new Template(tree);
			return template.func;
		},

		/**
		 * Returns a function to generate the DOM specified by the template.
		 * Also loads any AMD dependencies specified on the template's root node via the `requires` property.
		 * This is the function run when you use this module as a plugin.
		 * @param {string} mid - Absolute path to the resource.
		 * @param {Function} require - AMD's require() method.
		 * @param {Function} onload - Callback function which will be called with the compiled template.
		 * @param {Object} loaderConfig - Configuration object from the loader with `isBuild === true`
		 * when doing a build.
		 * @private
		 */
		load: function (mid, require, onload, loaderConfig) {
			require([textPlugin + "!" + mid], function (templateText) {
				// The build only need the call to requirejs-text/text to work.
				if (loaderConfig.isBuild) {
					onload();
					return;
				}

				var templateDom = handlebars.toDom(templateText),
					requires = templateDom.getAttribute("requires") ||
						templateDom.getAttribute("data-requires") || "";
				templateDom.removeAttribute("requires");
				templateDom.removeAttribute("data-requires");
				require(requires.split(/,\s*/), function () {
					var tree = handlebars.parse(templateDom);
					var template = new Template(tree);
					onload(template.func);
				});
			});
		},

		/**
		 * Build function to delegate template inlining to requirejs-text/text.
		 * @param {string} pluginName - This module id.
		 * @param {string} moduleName - Absolute path to the resource.
		 * @param {Function} write - A function to be called with a string of output to
		 * write to the optimized file. This function also contains a property function,
		 * write.asModule(moduleName, text).
		 * @param {Object} loaderConfig - Configuration object from the loader. `requirejs-text/text`
		 * needs `loaderConfig.inlineText === true` to work.
		 * @private
		 */
		write: function (pluginName, moduleName, write, loaderConfig) {
			// Requirejs-text is not listed in the dependency list so it is not
			// included in the layer. At build time requirejs works synchronously so
			// there is no callback.
			var text = require(textPlugin);
			text.write(textPlugin, moduleName, write, loaderConfig);
		}
	};

	return handlebars;
});