/** @module delite/Store */
define(["dcl/dcl", "dojo/when", "decor/Invalidating"], function (dcl, when, Invalidating) {

	/**
	 * Mixin for store management that creates render items from store items after
	 * querying the store. The receiving class must extend decor/Evented or delite/Widget.
	 *
	 * Classes extending this mixin automatically create render items that are consumable
	 * from store items after querying the store. This happens each time the `store`, `query` or
	 * `queryOptions` properties are set. If that store is Trackable it will be observed and render items
	 * will be automatically updated, added or deleted based on store notifications.
	 *
	 * @mixin module:delite/Store
	 */
	return dcl(Invalidating, /** @lends module:delite/Store# */{
		/**
		 * The store that contains the items to display.
		 * @member {dstore/Store}
		 * @default null
		 */
		store: null,

		/**
		 * A query filter to apply to the store.
		 * @member {Object}
		 * @default {}
		 */
		query: {},

		/**
		 * A function that processes the collection returned by the store query and returns a new collection
		 * (to sort it, etc...). This processing is applied before potentially tracking the store
		 * for modifications (if Trackable).
		 * Changing this function on the instance will not automatically refresh the class.
		 * @default identity function
		 */
		processQueryResult: function (store) { return store; },

		/**
		 * The render items corresponding to the store items for this widget. This is filled from the store and
		 * is not supposed to be modified directly. Initially null. 
		 * @member {Object[]}
		 * @default null
		 */
		renderItems: null,

		/**
		 * Creates a store item based from the widget internal item.
		 * @param {Object} renderItem - The render item.
		 * @returns {Object}
		 */
		renderItemToItem: function (renderItem) {
			return renderItem;
		},

		/**
		 * Returns the widget internal item for a given store item. By default it returns the store
		 * item itself.
		 * @param {Object} item - The store item.
		 * @returns {Object}
		 * @protected
		 */
		itemToRenderItem: function (item) {
			return item;
		},

		/**
		 * This method is called once the query has been executed to initialize the renderItems array
		 * with the list of initial render items.
		 *
		 * This method sets the renderItems property to the render items array passed as parameter. Once
		 * done, it fires a 'query-success' event.
		 * @param {Object[]} renderItems - The array of initial render items to be set in the renderItems property.
		 * @returns {Object[]} the renderItems array.
		 * @protected
		 */
		initItems: function (renderItems) {
			this.renderItems = renderItems;
			this.emit("query-success", { renderItems: renderItems, cancelable: false, bubbles: true });
			return renderItems;
		},

		/**
		 * If the store parameters are invalidated, queries the store, creates the render items and calls initItems() 
		 * when ready. If an error occurs a 'query-error' event will be fired.
		 * @param props
		 * @protected
		 */
		computeProperties: function (props) {
			if ("store" in props || "query" in props) {
				this.queryStoreAndInitItems(this.processQueryResult);
			}
		},

		/**
		 * Queries the store, creates the render items and calls initItems() when ready. If an error occurs
		 * a 'query-error' event will be fired.
		 *
		 * This method is not supposed to be called by application developer.
		 * It will be called automatically when modifying the store related properties or by the subclass
		 * if needed.
		 * @param processQueryResult - A function that processes the collection returned by the store query
		 * and returns a new collection (to sort it, etc...)., applied before tracking.
		 * @returns {Promise} If store to be processed is not null a promise that will be resolved when the loading 
		 * process will be finished.
		 * @protected
		 */
		queryStoreAndInitItems: function (processQueryResult) {
			this._untrack();
			if (this.store != null) {
				if (!this.store.filter && this.store instanceof HTMLElement && !this.store.attached) {
					// this might a be a store custom element, wait for it
					this.store.addEventListener("customelement-attached", this._attachedlistener = function () {
						this.queryStoreAndInitItems(this.processQueryResult);
					}.bind(this));
				} else {
					if (this._attachedlistener) {
						this.store.removeEventListener("customelement-attached", this._attachedlistener);
					}
					var collection = processQueryResult.call(this, this.store.filter(this.query));
					if (collection.track) {
						// user asked us to observe the store
						collection = this._tracked = collection.track();
						collection.on("add", this._itemAdded.bind(this));
						collection.on("update", this._itemUpdated.bind(this));
						collection.on("remove", this._itemRemoved.bind(this));
						collection.on("refresh", this._refreshHandler.bind(this));
					}
					return this.processCollection(collection);
				}
			} else {
				this.initItems([]);
			}
		},

		/**
		 * Called to process the items returned after querying the store.
		 * @param {dstore/Collection} collection - Items to be displayed.
		 * @protected
		 */
		processCollection: function (collection) {
			return this.fetch(collection).then(function (items) {
				return this.initItems(items.map(this.itemToRenderItem.bind(this)));
			}.bind(this), this._queryError.bind(this));
		},

		/**
		 * Called to perform the fetch operation on the collection.
		 * @param {dstore/Collection} collection - Items to be displayed.
		 * @protected
		 */
		fetch: function (collection) {
			return collection.fetch();
		},

		_queryError: function (error) {
			console.log(error);
			this.emit("query-error", { error: error, cancelable: false, bubbles: true });
		},

		_untrack: function () {
			if (this._tracked) {
				this._tracked.tracking.remove();
				this._tracked = null;
			}
		},

		destroy: function () {
			this._untrack();
		},

		/**
		 * This method is called when an item is removed from an observable store. The default
		 * implementation actually removes a renderItem from the renderItems array. This can be redefined but
		 * must not be called directly.
		 * @param {number} index - The index of the render item to remove.
		 * @param {Object[]} renderItems - The array of render items to remove the render item from.
		 * @protected
		 */
		itemRemoved: function (index, renderItems) {
			renderItems.splice(index, 1);
		},

		/**
		 * This method is called when an item is added in an observable store. The default
		 * implementation actually adds the renderItem to the renderItems array. This can be redefined but
		 * must not be called directly.
		 * @param {number} index - The index where to add the render item.
		 * @param {Object} renderItem - The render item to be added.
		 * @param {Object[]} renderItems - The array of render items to add the render item to.
		 * @protected
		 */
		itemAdded: function (index, renderItem, renderItems) {
			renderItems.splice(index, 0, renderItem);
		},

		/**
		 * This method is called when an item is updated in an observable store. The default
		 * implementation actually updates the renderItem in the renderItems array. This can be redefined but
		 * must not be called directly.
		 * @param {number} index - The index of the render item to update.
		 * @param {Object} renderItem - The render item data the render item must be updated with.
		 * @param {Object[]} renderItems - The array of render items to render item to be updated is part of.
		 * @protected
		 */
		itemUpdated: function (index, renderItem, renderItems) {
			// we want to keep the same item object and mixin new values into old object
			dcl.mix(renderItems[index], renderItem);
		},

		/**
		 * This method is called when an item is moved in an observable store. The default
		 * implementation actually moves the renderItem in the renderItems array. This can be redefined but
		 * must not be called directly.
		 * @param {number} previousIndex - The previous index of the render item.
		 * @param {number} newIndex - The new index of the render item.
		 * @param {Object} renderItem - The render item to be moved.
		 * @param {Object[]} renderItems - The array of render items to render item to be moved is part of.
		 * @protected
		 */
		itemMoved: function (previousIndex, newIndex, renderItem, renderItems) {
			// we want to keep the same item object and mixin new values into old object
			this.itemRemoved(previousIndex, renderItems);
			this.itemAdded(newIndex, renderItem, renderItems);
		},
		
		_refreshHandler: function () {
			this.queryStoreAndInitItems(this.processQueryResult);
		},

		/**
		 * When the store is observed and an item is removed in the store this method is called to remove the
		 * corresponding render item. This can be redefined but must not be called directly.
		 * @param {Event} event - The "remove" `dstore/Trackable` event.
		 * @private
		 */
		_itemRemoved: function (event) {
			if (event.previousIndex !== undefined) {
				this.itemRemoved(event.previousIndex, this.renderItems);
				// the change of the value of the renderItems property (splice of the array)
				// does not automatically trigger a notification. Hence:
				this.notifyCurrentValue("renderItems");
			}
			// if no previousIndex the items is removed outside of the range we monitor so we don't care
		},

		/**
		 * When the store is observed and an item is updated in the store this method is called to update the
		 * corresponding render item.  This can be redefined but must not be called directly.
		 * @param {Event} event - The "update" `dstore/Trackable` event.
		 * @private
		 */
		_itemUpdated: function (event) {
			if (event.index === undefined) {
				// this is actually a remove
				this.itemRemoved(event.previousIndex, this.renderItems);
			} else if (event.previousIndex === undefined) {
				// this is actually a add
				this.itemAdded(event.index, this.itemToRenderItem(event.target), this.renderItems);
			} else if (event.index !== event.previousIndex) {
				// this is a move
				this.itemMoved(event.previousIndex, event.index, this.itemToRenderItem(event.target), this.renderItems);
			} else {
				// we want to keep the same item object and mixin new values into old object
				this.itemUpdated(event.index, this.itemToRenderItem(event.target), this.renderItems);
			}
			// the change of the value of the renderItems property (splice of the array)
			// does not automatically trigger a notification. Hence:
			this.notifyCurrentValue("renderItems");
		},

		/**
		 * When the store is observed and an item is added in the store this method is called to add the
		 * corresponding render item. This can be redefined but must not be called directly.
		 * @param {Event} event - The "add" `dstore/Trackable` event.
		 * @private
		 */
		_itemAdded: function (event) {
			if (event.index !== undefined) {
				this.itemAdded(event.index, this.itemToRenderItem(event.target), this.renderItems);
				// the change of the value of the renderItems property (splice of the array)
				// does not automatically trigger a notification. Hence:
				this.notifyCurrentValue("renderItems");
			}
			// if no index the item is added outside of the range we monitor so we don't care
		}
	});
});
