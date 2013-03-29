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
                self.fields.each(function(field) {
                    var value = result[fieldToCol(field)];
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
            'click .query-execute': 'search',
            'click .field-add': 'addField',
            'click .abandon-changes': function() { this.trigger('redisplay'); }
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
            var ul = $('<ul class="spqueryfields sortable">').appendTo(self.el);
            $('<a class="field-add">').text('New field...').appendTo(self.el);
            $('<ul class="spqueryfield-delete sortable">').appendTo(self.el);
            this.$el.append('<input type="button" value="Query" class="query-execute">',
                            '<input type="button" value="Abandon Changes" class="abandon-changes" disabled>');
            self.query.on('saverequired', this.saveRequired, this);
            self.saveButton.render().$el.appendTo(self.el);

            self.query.rget('fields', true).done(function(spqueryfields) {
                self.fields = spqueryfields;
                spqueryfields.each(function(spqueryfield) {
                    var ui = new QueryFieldUI({
                        parentView: self,
                        model: self.model,
                        spqueryfield: spqueryfield,
                        el: $('<li class="spqueryfield">')
                    });
                    ui.render().$el.appendTo(ul);
                    ui.on('remove', function(ui, field) { self.fields.remove(field); });
                });
                self.$('ul.sortable').sortable({
                    connectWith: 'ul.sortable',
                    update: function (event, ui) {
                        self.trigger('positionschanged');
                    }
                });
            });

            $('<table class="results" width="100%"></div>').appendTo(self.el);

            return self;
        },
        saveRequired: function() {
            this.$('.query-execute').prop('disabled', true);
            this.$('.abandon-changes').prop('disabled', false);
        },
        addField: function() {
            var newField = new (api.Resource.forModel('spqueryfield'))();
            newField.set({sorttype: 0, query: this.query.url()});

            var addFieldUI = new QueryFieldUI({
                parentView: this,
                model: this.model,
                el: $('<li class="spqueryfield">'),
                spqueryfield: newField
            });
            this.$('.spqueryfields').append(addFieldUI.render().el).sortable('refresh');
            addFieldUI.on('completed', function() { this.fields.add(newField); }, this);
            this.trigger('positionschanged');
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
