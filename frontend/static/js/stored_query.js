define([
'jquery', 'underscore', 'backbone', 'navigation', 'cs!appresource', 'schema',
'specifyapi', 'cs!fieldformat', 'cs!props', 'cs!savebutton', 'whenall', 'scrollresults',
'jquery-bbq', 'jquery-ui'
], function($, _, Backbone, navigation, getAppResource, schema, api, fieldformat, props, SaveButton, whenAll, ScrollResults) {
    "use strict";

    var STRINGID_RE = /^([^\.]*)\.([^\.]*)\.(.*)$/;

    function stringIdToFieldSpec(stringId) {
        var match = STRINGID_RE.exec(stringId);
        var path = match[1].split(',');
        var tableName = match[2];
        var fieldName = match[3];
        var rootTable = schema.getModelById(parseInt(path.shift(), 10));

        var joinPath = [];
        var node = rootTable;
        _.each(path, function(elem) {
            var tableId_fieldName = elem.split('-');
            var table = schema.getModelById(parseInt(tableId_fieldName[0], 10));
            var fieldName = tableId_fieldName[1];
            var field = _.isUndefined(fieldName) ? node.getField(table.name) : node.getField(fieldName);
            joinPath.push(field);
            node = table;
        });

        var field = node.getField(fieldName);
        return _.extend({joinPath: joinPath, table: node, field: field}, extractDatePart(fieldName));
    }

    var DATE_PART_RE = /(.*)((NumericDay)|(NumericMonth)|(NumericYear))$/;

    function extractDatePart(fieldName) {
        var match = DATE_PART_RE.exec(fieldName);
        return match ? {
            fieldName: match[1],
            datePart: match[2].replace('Numeric', '')
        } : {
            fieldName: fieldName,
            datePart: null
        };
    }

    var FieldInputUI = Backbone.View.extend({
        events: {
            'change input': 'changed'
        },
        opName: 'NA',
        input: '<input type="text">',
        getValue: function() {
            return this.$('input').val();
        },
        setValue: function(value) {
            this.$('input').val(value);
        },
        render: function() {
            $('<a class="field-operation">').text(this.opName).appendTo(this.el);
            this.input && $(this.input).appendTo(this.el);
            return this;
        },
        changed: function() {
            this.trigger('changed', this, this.getValue());
        }
    });

    var opInfo = [
        {opName: 'Like'},
        {opName: '='},
        {opName: '>'},
        {opName: '<'},
        {opName: '>='},
        {opName: '<='},
        {opName: 'True', input: null},
        {opName: 'False', input: null},
        {opName: 'Does not matter', input: null},

        {opName: 'Between',
         input: '<input type="text"> and <input type="text">',
         getValue: function() {
             return _.map(this.$('input'), function(input) { return $(input).val(); }).join(',');
         },
         setValue: function(value) {
             var values = value.split(',');
             _.each(this.$('input'), function(input, i) { $(input).val(values[i]); });
         }
        },

        {opName: 'In'},
        {opName: 'Contains'},
        {opName: 'Empty', input: null},
        {opName: 'True or Null', input: null},
        {opName: 'True or False', input: null}
    ];

    var FieldInputUIByOp = _.map(opInfo, function(extras) { return FieldInputUI.extend(extras); });

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

    var AddFieldUI = Backbone.View.extend({
        events: {
            'change .field-select': 'fieldSelected',
            'change .op-select': 'opSelected',
            'change .datepart-select': 'datePartSelected',
            'click .field-operation': 'backUpToOperation',
            'click .field-label-field': 'backUpToField',
            'click .field-label-datepart': 'backUpToDatePart'
        },
        initialize: function(options) {
            this.spqueryfield = options.spqueryfield;
            if (this.spqueryfield.isNew()) {
                this.joinPath = [];
                this.table = this.model;
            } else {
                var fs = stringIdToFieldSpec(this.spqueryfield.get('stringid'));
                this.table = fs.table;
                this.joinPath = fs.joinPath.concat(this.table.getField(fs.fieldName));
                this.datePart = fs.datePart;
                this.operation = this.spqueryfield.get('operstart');
                this.value = this.spqueryfield.get('startvalue');
            }
        },
        render: function() {
            this.$el.append('<span class="field-label">',
                            '<select class="field-select">',
                            '<select class="op-select">',
                            '<select class="datepart-select">');
            this.update();
            this.inputUI && this.inputUI.setValue(this.value);
            return this;
        },
        setupFieldSelect: function() {
            this.$('.op-select, .datepart-select').hide();
            this.$('.field-input').remove();
            var fieldSelect = this.$('.field-select')
                    .empty()
                    .show()
                    .append('<option>Select Field...</option>');

            _.each(this.table.getAllFields(), function(field) {
                $('<option>', {value: field.name})
                    .text(field.getLocalizedName())
                    .appendTo(fieldSelect);
            }, this);
        },
        setupOpSelect: function() {
            this.$('.field-select, .datepart-select').hide();
            this.$('.field-input').remove();
            var opSelect = this.$('.op-select')
                    .empty()
                    .show()
                    .append('<option>Select Op...</option>');

            _.each(opInfo, function(info, i) {
                $('<option>', {value: i}).text(info.opName).appendTo(opSelect);
            }, this);
        },
        setupDatePartSelect: function() {
            this.$('.field-select, .op-select').hide();
            this.$('.field-input').remove();
            var select = this.$('.datepart-select').empty().show();
            var options = _(['Extract...', 'None', 'Year', 'Month', 'Day']).each(function(datepart) {
                $('<option>', {value: datepart}).text(datepart).appendTo(select);
            });
        },
        updateLabel: function() {
            var fieldLabel = this.$('.field-label').empty();
            _.chain(this.joinPath)
                .invoke('getLocalizedName')
                .each(function(fieldName) { $('<a class="field-label-field">').text(fieldName).appendTo(fieldLabel); });
            this.datePart && $('<a class="field-label-datepart">').text('(' + this.datePart + ')').appendTo(fieldLabel);
        },
        fieldSelected: function() {
            var field = this.table.getField(this.$('.field-select').val());
            this.joinPath.push(field);
            this.update();
        },
        update: function() {
            var field = _.last(this.joinPath);
            this.updateLabel();
            if (!field) {
                this.table = this.model;
                this.setupFieldSelect();
            } else if (field.isRelationship) {
                this.table = field.getRelatedModel();
                this.setupFieldSelect();
            } else if (_.isUndefined(this.datePart) &&
                       _(['java.util.Date', 'java.util.Calendar']).contains(field.type)) {
                this.setupDatePartSelect();
            } else if (_.isUndefined(this.operation)) {
                this.setupOpSelect();
            } else {
                this.fieldComplete();
            }
        },
        fieldComplete: function() {
            this.$('.field-select, .datepart-select, .op-select').hide();
            this.inputUI = new (FieldInputUIByOp[this.operation])({
                el: $('<span class="field-input">')
            });
            this.inputUI.render().$el.appendTo(this.el);
            this.inputUI.on('changed', this.valueChanged, this);
            this.alreadyCompletedOnce && this.updateSpQueryField();
            this.alreadyCompletedOnce = true;
            this.trigger('completed', this);
        },
        opSelected: function() {
            this.operation = this.$('.op-select').val();
            this.update();
        },
        datePartSelected: function() {
            this.datePart = this.$('.datepart-select').val();
            this.datePart === 'None' && (this.datePart = null);
            this.update();
        },
        backUpToField: function(evt) {
            var index = _(this.$('.field-label-field')).indexOf(evt.currentTarget);
            this.joinPath = _(this.joinPath).first(index);
            this.value = this.operation = this.datePart = undefined;
            this.update();
        },
        backUpToDatePart: function() {
            this.value = this.operation = this.datePart = undefined;
            this.update();
        },
        backUpToOperation: function() {
            this.value = this.operation = undefined;
            this.update();
        },
        valueChanged: function(inputUI, value) {
            this.value = value;
            this.spqueryfield.set('startvalue', value);
        },
        makeTableList: function() {
            var list = [this.model.tableId];
            return _.chain(this.joinPath).initial().map(function(field) {
                var relatedModel = field.getRelatedModel();
                return relatedModel.name.toLowerCase() === field.name.toLowerCase() ?
                    relatedModel.tableId : (relatedModel.tableId + '-' + field.name.toLowerCase());
            }).value().join(',');
        },
        makeStringId: function(tableList) {
            var fieldName = _.last(this.joinPath).name;
            if (this.datePart) {
                fieldName += 'Numeric' + this.datePart;
            }
            return [
                tableList,
                this.table.name.toLowerCase(),
                fieldName
            ].join('.');
        },
        updateSpQueryField: function() {
            var tableList = this.makeTableList();
            this.spqueryfield.set({
                operstart: this.operation,
                tablelist: tableList,
                stringid: this.makeStringId(tableList),
                fieldname: _.last(this.joinPath).name,
                isdisplay: true,
                isnot: false
            });
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
            self.query.on('all', function() {
                console.log(arguments);
            });
            self.saveButton = new SaveButton({ model: self.query });
        },
        render: function() {
            var self = this;
            self.$el.append($('<h2>').text(self.query.get('name')));
            var ul = $('<ul>').appendTo(self.el);
            $('<input type="button" value="Search">').appendTo(self.el);
            self.saveButton.render().$el.appendTo(self.el);

            self.query.rget('fields', true).done(function(spqueryfields) {
                self.fields = spqueryfields;
                self.fieldUIs = spqueryfields.map(function(spqueryfield) {
                    return new AddFieldUI({
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

            var addFieldUI = new AddFieldUI({
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
