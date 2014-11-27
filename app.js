require([
	"angular",
	"delite/register",
	"deliteful/list/List",
	"angular-delite/wrappers/widget",
	"angular-delite/dstore/TrackableRest"
], function (angular, register, List, wrapper) {
		
		angular.module("app", ["dstore.trackableRest"])
			// creating a trackable REST store as a service
			.factory("BookList", function (TrackableRest) {
				return new TrackableRest({target: "http://nonews.mybluemix.net/book/"});
			})
			// creating directive <ng-list ... ></ng-list>
			.directive("ngList", ["BookList", function (BookList) {
				return wrapper(List, {selectedItems: "="}, {
					store         : BookList,
					labelAttr     : "title",
					idAttr        : "id",
					righttextFunc : function (item) { return "ISBN " + item.isbn; }
				});
			}])
			.controller("MainCtrl", ["$scope", function ($scope) {
				$scope.add = function (newTitle, newISBN) {
					$scope.books.store.add({title: newTitle, isbn: newISBN});
				};
				$scope.removeSelected = function () {
					$scope.selectedItems.forEach(function (item) {
						$scope.books.store.remove(item.id);
					});
				};
			}]);

		// boostrapping
		angular.element(document).ready(function () {
			angular.bootstrap(document, ["app"]);	// start angular
		});
	});
