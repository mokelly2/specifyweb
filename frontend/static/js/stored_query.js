define([
'jquery', 'underscore', 'backbone', 'navigation', 'schema', 'queryfield',
'specifyapi', 'cs!fieldformat', 'cs!savebutton', 'whenall', 'scrollresults',
'jquery-bbq', 'jquery-ui'
], function($, _, Backbone, navigation, schema, QueryFieldUI, api, fieldformat, SaveButton, whenAll, ScrollResults) {
    "use strict";

    var Results = Backbone.View.extend({
        events: {
            'click a.query-result': 'navToResult'
        },
        initialize: function(options) {
            this.fields = options.fields;
            this.model = options.model;
            this.fieldUIs = options.fieldUIs;
            this.initResults = options.results;
        },
        render: function() {
            this.addResults(this.initResults);
            return this;
        },
        detectEndOfResults: function(results) {
            return results.length < 2;
        },
        addResults: function(results) {
            var self = this;
            var columns = results.shift();
            var fieldToCol = function(field) {
                return _(columns).indexOf(field.id);
            };

            _.each(results, function(result) {
                var row = $('<tr>').appendTo(self.el);
                var resource = new (api.Resource.forModel(self.model))({
                    id: result[0]
                });
                var href = resource.viewUrl();
                _.each(self.fieldUIs, function(fieldUI) {
                    var value = result[fieldToCol(fieldUI.spqueryfield)];
                    // var field = fieldUI.fieldSpec.field;
                    // if (field) {
                    //     value = fieldformat(field, value);
                    // }
                    row.append($('<td>').append($('<a>', {
                        href: href,
                        "class": "query-result"
                    }).text(value)));
                });
            });
            this.lastResult = _.last(results);
        },
        getLastID: function() {
            return this.lastResult && this.lastResult[0];
        },
        navToResult: function(evt) {
            evt.preventDefault();
            return navigation.go($(evt.currentTarget).prop('href'));
        }
    });

    return Backbone.View.extend({
        events: {
            'click :button': 'search',
            'click .field-add': 'addField'
        },
        initialize: function(options) {
            var self = this;
            self.query = options.query;
            self.model = schema.getModel(self.query.get('contextname'));
            self.saveButton = new SaveButton({ model: self.query });
            self.saveButton.on('savecomplete', function() { this.trigger('redisplay'); }, this);
        },
        render: function() {
            var self = this;
            self.$el.append($('<h2>').text(self.query.get('name')));
            var ul = $('<ul>').appendTo(self.el);
            var button = $('<input type="button" value="Query">').appendTo(self.el);
            self.query.on('saverequired subsaverequired', button.hide, button);
            self.saveButton.render().$el.appendTo(self.el);

            self.query.rget('fields', true).done(function(spqueryfields) {
                self.fields = spqueryfields;
                self.fieldUIs = spqueryfields.map(function(spqueryfield) {
                    return new QueryFieldUI({
                        model: self.model,
                        spqueryfield: spqueryfield,
                        el: $('<li class="spqueryfield">')
                    });
                });

                _.each(self.fieldUIs, function(fieldUI) { ul.append(fieldUI.render().el); });
                ul.append('<li class="spqueryfield"><a class="field-add">Add Field...</a></li>');

            });

            $('<table class="results" width="100%"></div>').appendTo(self.el);

            return self;
        },
        addField: function() {
            var newField = new (api.Resource.forModel('spqueryfield'))();
            var position = this.fields.chain()
                    .map(function(field) { return field.get('position'); })
                    .sort().last().value() + 1;
            newField.set({position: position, sorttype: 0, query: this.query.url()});

            var addFieldUI = new QueryFieldUI({
                model: this.model,
                el: $('<li class="spqueryfield">'),
                spqueryfield: newField
            });
            addFieldUI.render().$el.insertBefore(this.$('.field-add'));
            addFieldUI.on('completed', function() { this.fields.add(newField); }, this);
        },
        renderHeader: function() {
            var header = $('<tr>');
            _.each(this.fieldUIs, function(fieldUI) {
                header.append($('<th>').text(fieldUI.getFieldName()));
            });
            return header;
        },
        search: function(evt) {
            var self = this;
            var table = self.$('table.results');

            // var queryParams = {};
            // _.each(self.fieldUIs, function(fieldUI) {
            //     _.extend(queryParams, fieldUI.getQueryParam());
            // });

            table.empty();
            //table.append(self.renderHeader());

            // var ajaxUrl = $.param.querystring("/stored_query/query/" + self.query.id + "/",
            //                                   queryParams);

            var ajaxUrl = "/stored_query/query/" + self.query.id + "/";
            $.get(ajaxUrl).done(function(results) {
                var view = new ScrollResults({
                    View: Results,
                    el: table,
                    viewOptions: {
                        fields: self.fields,
                        model: self.model,
                        fieldUIs: self.fieldUIs,
                        results: results
                    },
                    ajaxUrl: ajaxUrl
                });
                view.render();
                view.fetchMoreWhileAppropriate();
            });
        }
    });
});
