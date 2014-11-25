/** @module delite/DisplayContainer */
define(["dcl/dcl", "dojo/Deferred", "dojo/when", "delite/Container"],
	function (dcl, Deferred, when, Container) {
	/**
	 * Mixin for widget containers that need to show on or off a child.
	 *
	 * When the show method is called a container extending this mixin is able to be notified that one of
	 * its children must be displayed. Before displaying it, it will fire the `delite-display-load` event
	 * giving a chance to a listener to load and create the child if not yet available before proceeding with
	 * the display. After the display has been performed a `delite-display-complete` event will be fired.
	 * @mixin module:delite/DisplayContainer
	 * @augments module:delite/Container
	 */
	return dcl(Container, /** @lends module:delite/DisplayContainer# */ {
		/**
		 * This method must be called to display a particular destination child on this container.
		 * @param {Element|string} dest - Element or Element id that points to the child this container must
		 * display.
		 * @param {Object} [params] - Optional params that might be taken into account when displaying the child.
		 * This can be the type of visual transitions involved. This might vary from one DisplayContainer to another.
		 * @returns {Promise} A promise that will be resolved when the display & transition effect will have been
		 * performed.
		 */
		show: function (dest, params) {
			// we need to warn potential app controller we are going to load a view & transition
			var event = {
				dest: dest,
				loadDeferred: new Deferred()
			};
			var self = this, displayDeferred = new Deferred();
			dcl.mix(event, params);
			// we now need to warn potential app controller we need to load a new child
			// when the controller told us it will handle child loading use the deferred from the event
			// otherwise call the container load method
			// note: emit() does not return the native event when it has been prevented but false value instead...
			var loadDeferred = this.emit("delite-display-load", event) ? this.load(dest) : event.loadDeferred;
			when(loadDeferred, function (value) {
				// if view is not already a child this means we loaded a new view (div), add it
				if (self.getIndexOfChild(value.child) === -1) {
					self.addChild(value.child, value.index);
				}
				// the child is here, actually perform the display
				// notify everyone we are going to proceed
				event = {
					dest: dest,
					cancelable: false
				};
				dcl.mix(event, params);
				dcl.mix(event, value);

				/**
				 * Dispatched before child is shown.
				 * @example
				 * document.addEventListener("delite-before-show", function (evt) {
				 *      console.log("about to show child", evt.child);
				 * });
				 * @event module:delite/DisplayContainer#delite-before-show
				 * @property {Element} child - reference to child element
				 */
				self.emit("delite-before-show", event);

				when(self.changeDisplay(value.child, event), function () {

					/**
					 * Dispatched after child is shown.
					 * @example
					 * document.addEventListener("delite-after-show", function (evt) {
					 *      console.log("just displayed child", evt.child);
					 * });
					 * @event module:delite/DisplayContainer#delite-after-show
					 * @property {Element} child - reference to child element
					 */
					self.emit("delite-after-show", event);

					displayDeferred.resolve(value);
				});
			});
			return displayDeferred.promise;
		},

		/**
		 * This method must be called to hide a particular destination child on this container.
		 * @param {Element|string} dest - Element or Element id that points to the child this container must
		 * hide.
		 * @param {Object} [params] - Optional params that might be taken into account when removing the child.
		 * This can be the type of visual transitions involved.  This might vary from one DisplayContainer to another.
		 * @returns {Promise} A promise that will be resolved when the display & transition effect will have been
		 * performed.
		 */
		hide: function (dest, params) {
			// we need to warn potential app controller we are going to load a view & transition
			var event = {
				dest: dest,
				loadDeferred: new Deferred(),
				bubbles: true,
				cancelable: true,
				hide: true
			};
			var self = this, displayDeferred = new Deferred();
			dcl.mix(event, params);
			// we now need to warn potential app controller we need to load a child (this is needed to be able to 
			// get a hand on it)
			// when the controller told us it will handle child loading use the deferred from the event
			// otherwise call the container load method
			// note: emit() does not return the native event when it has been prevented but false value instead.

			/**
			 * Dispatched to let an application level listener create/load the child node.
			 * @example
			 * document.addEventListener("delite-display-load", function (evt) {
			 *     // fetch the data for the specified id, then create a node with that data
			 *     var def = evt.loadDeferred;
			 *     fetchData(evt.dest).then(function(data) {
			 *         var child = document.createElement("div");
			 *         child.innerHTML = data;
			 *         def.resolve({child: child});
			 *     });
			 *     evt.preventDefault();
			 * });
			 * @event module:delite/DisplayContainer#delite-display-load
			 * @property {Promise} loadDeferred - promise to resolve with the child element
			 */
			var loadDeferred = this.emit("delite-display-load", event) ? this.load(dest) : event.loadDeferred;

			when(loadDeferred, function (value) {
				// the child is here, actually perform the display
				// notify everyone we are going to proceed
				event = {
					dest: dest,
					bubbles: true,
					cancelable: false,
					hide: true
				};
				dcl.mix(event, params);
				dcl.mix(event, value);

				/**
				 * Dispatched before child is hidden.
				 * @example
				 * document.addEventListener("delite-before-hide", function (evt) {
				 *      console.log("about to hide child", evt.child);
				 * });
				 * @event module:delite/DisplayContainer#delite-before-hide
				 * @property {Element} child - reference to child element
				 */
				self.emit("delite-before-hide", event);

				when(self.changeDisplay(value.child, event), function () {
					// if view is not already removed, remove it
					if (self.getIndexOfChild(value.child) !== -1) {
						self.removeChild(value.child);
					}

					/**
					 * Dispatched after child is hidden.
					 * @example
					 * document.addEventListener("delite-after-hide", function (evt) {
					 *      console.log("just hid child", evt.child);
					 * });
					 * @event module:delite/DisplayContainer#delite-after-hide
					 * @property {Element} child - reference to child element
					 */
					self.emit("delite-after-hide", event);

					displayDeferred.resolve(value);
				});
			});
			return displayDeferred.promise;
		},

		/**
		 * This method must perform the display and possible transition effect.  It is meant to be specialized by
		 * subclasses.
		 * @param {Element|string} widget - Element or Element id that points to the child this container must
		 * show or hide.
		 * @param {Object} [params] - Optional params that might be taken into account when displaying the child.  This
		 * can be the type of visual transitions involved.  This might vary from one DisplayContainer to another.
		 * By default on the "hide" param is supporting meaning that the transition should hide the widget
		 * not display it.
		 * @returns {Promise} Optionally a promise that will be resolved when the display & transition effect will have
		 * been performed.
		 */
		changeDisplay: function (widget, /*jshint unused: vars*/params) {
			if (params.hide === true) {
				widget.style.visibility = "hidden";
				widget.style.display = "none";
			} else {
				widget.style.visibility = "visible";
				widget.style.display = "";
			}
		},

		/**
		 * This method can be redefined to load a child of the container.  By default it just looks up
		 * elements by id.
		 * @protected
		 * @param {Element|string} widget - Element or Element id that points to the child this container must
		 * display.
		 * @returns {Promise|Object} If asynchronous a promise that will be resolved when the child will have been 
		 * loaded with an object of the following form: `{ child: widget }` or with an optional index
		 * `{ child: widget, index: index }`. Other properties might be added to	the object if needed.
		 * If the action is synchronous this directly returns the given object.
		 */
		load: function (dest) {
			return { child: typeof dest === "string" ? this.ownerDocument.getElementById(dest) : dest };
		}
	});
});