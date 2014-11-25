/** @module delite/Template */
define(["./register"], function (register) {

	var elementCache = {};

	/**
	 * Return cached reference to Element with given tag name.
	 * @param {string} tag
	 * @returns {Element}
	 * @protected
	 */
	function getElement(tag) {
		if (!(tag in elementCache)) {
			elementCache[tag] = register.createElement(tag);
		}
		return elementCache[tag];
	}

	var attrMap = {};

	/**
	 * Given a tag and attribute name, return the associated property name,
	 * or undefined if no such property exists, for example:
	 *
	 * - getProp("div", "tabindex") --> "tabIndex"
	 * - getProp("div", "role") --> undefined
	 *
	 * Note that in order to support SVG, getProp("svg", "class") returns null instead of className.
	 *
	 * @param {string} tag - Tag name.
	 * @param {string} attrName - Attribute name.
	 * @returns {string}
	 * @protected
	 */
	function getProp(tag, attrName) {
		if (!(tag in attrMap)) {
			var proto = getElement(tag),
				map = attrMap[tag] = {};
			for (var prop in proto) {
				map[prop.toLowerCase()] = prop;
			}
			map.style = "style.cssText";
		}
		return attrMap[tag][attrName];
	}

	/**
	 * Class to compile an AST representing a template into a function to generate that template's DOM,
	 * and set up listeners to update the DOM as the widget properties change.
	 *
	 * See the reference documentation for details on the AST format.
	 *
	 * @mixin module:delite/Template
	 */
	var Template = register.dcl(null, /** @lends module:delite/Template# */ {
		/**
		 * Given an AST representation of the template, generates a function that:
		 *
		 * 1. generates DOM corresponding to the template
		 * 2. returns an object including a function to be called to update that DOM
		 *    when widget properties have changed.
		 *
		 * The function is available through this.func, i.e.:
		 *
		 *     var template = new Template(ast);
		 *     template.func(document, register);
		 *
		 * @param {Object} tree - AST representing the template.
		 * @param {string} rootNodeName - Name of variable for the root node of the tree, typically `this`.
		 * @param {boolean} createRootNode - If true, create node; otherwise assume node exists in variable `nodeName`.
		 * @private
		 */
		constructor: function (tree, rootNodeName, createRootNode) {
			this.buildText = [];	// code to build the initial DOM
			this.observeText = [];	// code to update the DOM when widget properties change
			this.dependsOn = {};	// set of properties referenced in the template

			this.generateNodeCode(rootNodeName || "this", createRootNode, tree);

			// Generate text of function.
			this.text = this.buildText.join("\n") + "\n" +
				"return {\n" +
					"\tdependencies: " + JSON.stringify(Object.keys(this.dependsOn)) + ",\n" +
					"\trefresh: function(props){\n\t\t" +
						this.observeText.join("\n\t\t") +
					"\n\t}.bind(this)\n" +
				"};\n";

			/* jshint evil:true */
			this.func = new Function("document", "register", this.text);
		},

		/**
		 * Text of the generated function.
		 * @member {string}
		 * @readonly
		 */
		text: "",

		/**
		 * Generated function.
		 * @member {Function}
		 * @readonly
		 */
		func: null,

		/**
		 * Generate code that executes `statement` if any of the properties in `dependencies` change.
		 * @param {string[]} dependencies - List of variables referenced in `statement`.
		 * Must have at least one entry.
		 * @param {string} statement - Content inside if() statement.
		 * @private
		 */
		generateWatchCode: function (dependencies, statement) {
			this.observeText.push(
					"if(" + dependencies.map(function (prop) {
					return "'" + prop + "' in props";
				}).join(" || ") + ")",
					"\t" + statement + ";"
			);
			dependencies.forEach(function (prop) { this.dependsOn[prop] = true; }, this);
		},

		/**
		 * Generate JS code to create and add children to a node named nodeName.
		 * @param {string} nodeName
		 * @param {Object[]} children
		 * @private
		 */
		generateNodeChildrenCode: function (nodeName, children) {
			children.forEach(function (child, idx) {
				var childName = (nodeName === "this" ? "" : nodeName) + "c" + (idx + 1);
				if (child.tag) {
					// Standard DOM node, recurse
					this.generateNodeCode(childName, true, child);
					this.buildText.push(
						nodeName + ".appendChild(" + childName + ");"
					);
				} else {
					// JS code to compute text value
					var textNodeName = childName + "t" + (idx + 1);

					// Generate code to create DOM text node.  If the text contains property references, just
					// leave it blank for now, and set the real value in refreshRendering().\
					this.buildText.push(
						"var " + textNodeName + " = document.createTextNode(" +
							(child.dependsOn.length ? "''" : child.expr) + ");",
						nodeName + ".appendChild(" + textNodeName + ");"
					);

					// watch for widget property changes and update DOM text node
					if (child.dependsOn.length) {
						this.generateWatchCode(child.dependsOn, textNodeName + ".nodeValue = " + child.expr);
					}
				}
			}, this);
		},

		/**
		 * Generate JS code to create a node called nodeName based on templateNode, then
		 * set its properties, attributes, and children, according to descendants of templateNode.
		 * @param {string} nodeName - The node will be in a variable with this name.
		 * @param {boolean} createNode - If true, create node; otherwise assume node exists in variable `nodeName`
		 * @param {Object} templateNode - An object representing a node in the template, as described in module summary.
		 * @private
		 */
		generateNodeCode: function (nodeName, createNode, templateNode) {
			/* jshint maxcomplexity:15*/
			// Helper string for setting up attach-point(s), ex: "this.foo = this.bar = ".
			var ap = (templateNode.attachPoints || []).map(function (n) {
				return  "this." + n + " = ";
			}).join("");

			// Create node
			if (createNode) {
				this.buildText.push(
					"var " + nodeName + " = " + ap + (templateNode.xmlns ?
					"document.createElementNS('" + templateNode.xmlns + "', '" + templateNode.tag + "');" :
					"register.createElement('" + templateNode.tag + "');")
				);
			} else if (ap) {
				// weird case that someone set attach-point on root node
				this.buildText.push(ap + nodeName + ";");
			}

			// Set attributes/properties
			for (var attr in templateNode.attributes) {
				var info = templateNode.attributes[attr];

				// Generate code to set this property or attribute
				var propName = getProp(templateNode.tag, attr),
					js = info.expr;		// code to compute property value

				if (attr === "class" && !templateNode.xmlns) {
					// Special path for class to not overwrite classes set by application or by other code.
					if (info.dependsOn.length) {
						// Value depends on widget properties that may not be set yet.
						// Watch for changes to those widget properties and reflect them to the DOM.
						this.generateWatchCode(info.dependsOn,
								"this.setClassComponent('template', " + js + ", " + nodeName + ")");
					} else {
						// Value is a constant; set it during render().
						this.buildText.push("this.setClassComponent('template', " + js + ", " + nodeName + ")");
					}
				} else {
					if (info.dependsOn.length) {
						// Value depends on widget properties that may not be set yet.
						// Watch for changes to those widget properties and reflect them to the DOM.
						this.generateWatchCode(info.dependsOn, propName ? nodeName + "." + propName + " = " + js :
							"this.setOrRemoveAttribute(" + nodeName + ", '" + attr + "', " + js + ")");
					} else {
						// Value is a constant; set it during render().
						this.buildText.push(propName ? nodeName + "." + propName + " = " + js :
							nodeName + ".setAttribute('" + attr + "', " + js + ");");
					}
				}
			}

			// If this node is a custom element, make it immediately display the property changes I've made
			if (/-/.test(templateNode.tag)) {
				this.buildText.push(nodeName + ".deliver();");
				this.observeText.push(nodeName + ".deliver();");
			}

			// Setup connections
			for (var type in templateNode.connects) {
				var handler = templateNode.connects[type];
				var callback = /^[a-zA-Z0-9_]+$/.test(handler) ?
					"this." + handler + ".bind(this)" :		// standard case, connecting to a method in the widget
					"function(event){" + handler + "}";	// connect to anon func, ex: on-click="g++;". used by dapp.
				this.buildText.push("this.on('" + type + "', " + callback + ", " + nodeName  + ");");
			}

			// Create descendant Elements and text nodes
			this.generateNodeChildrenCode(nodeName, templateNode.children);
		}
	});

	// Export helper funcs so they can be used by handlebars.js
	Template.getElement = getElement;
	Template.getProp = getProp;

	return Template;
});