define(['jquery', 'underscore', 'backbone', 'schema'], function($, _, Backbone, schema) {
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
            var text = (this.options.negate ? 'Not ' : '') + this.opName;
            $('<a class="field-operation">').text(text).appendTo(this.el);
            this.input && $(this.input).appendTo(this.el);
            return this;
        },
        changed: function() {
            this.trigger('changed', this, this.getValue());
        }
    });

    var types = {
        strings: ['text', 'java.lang.String'],
        numbers: ['java.lang.Integer', 'java.lang.Long', 'java.lang.Byte',
                  'java.lang.Short', 'java.lang.Float', 'java.lang.Double', 'java.math.BigDecimal'],
        dates: ['java.util.Calendar', 'java.util.Date', 'java.sql.Timestamp'],
        bools: ['java.lang.Boolean']
    };

    var opInfo = [
        {opName: 'Like', types: ['strings']},
        {opName: '=', types: ['strings', 'numbers', 'dates']},
        {opName: '>', types: ['numbers', 'dates']},
        {opName: '<', types: ['numbers', 'dates']},
        {opName: '>=', types: ['numbers']},
        {opName: '<=', types: ['numbers']},
        {opName: 'True', types: ['bools'], input: null},
        {opName: 'False', types: ['bools'], input: null},
        {opName: 'Does not matter', types: ['bools'], input: null},

        {opName: 'Between', types: ['strings', 'dates', 'numbers'],
         input: '<input type="text"> and <input type="text">',
         getValue: function() {
             return _.map(this.$('input'), function(input) { return $(input).val(); }).join(',');
         },
         setValue: function(value) {
             var values = value.split(',');
             _.each(this.$('input'), function(input, i) { $(input).val(values[i]); });
         }
        },

        {opName: 'In', types: ['strings', 'numbers']},
        {opName: 'Contains', types: ['strings']},
        {opName: 'Empty', types: ['strings', 'bools', 'dates', 'numbers'], input: null},
        {opName: 'True or Null', types: ['bools'], input: null},
        {opName: 'False or Null', types: ['bools'], input: null}
    ];

    var FieldInputUIByOp = _.map(opInfo, function(extras) { return FieldInputUI.extend(extras); });

    return Backbone.View.extend({
        events: {
            'change .field-select': 'fieldSelected',
            'change .op-select.op-type': 'opSelected',
            'change .op-select.op-negate': 'opNegateSelected',
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
                this.negate = this.spqueryfield.get('isnot');
            }
        },
        getTypeForOp: function() {
            if (this.datePart) return 'numbers';
            var field = _.last(this.joinPath);
            if (field.model.name === 'CollectionObject' &&
                field.name === 'catalogNumber') return 'numbers';

            for (var type in types) {
                if (_(types[type]).contains(field.type)) return type;
            }
            return null;
        },
        render: function() {
            this.$el.append('<span class="field-label">',
                            '<select class="field-select">',
                            '<select class="op-select op-negate">',
                            '<select class="op-select op-type">',
                            '<select class="datepart-select">');
            this.$('.op-negate').append('<option value="undefined">Negate?</option>',
                                        '<option value="no">No</option>',
                                        '<option value="yes">Yes</option>');

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
            this.operation = this.negate = undefined;
            this.$('.field-select, .datepart-select').hide();
            this.$('.field-input').remove();
            this.$('.op-select').show();
            this.$('.op-negate').val('undefined');
            var opSelect = this.$('.op-type').empty().append('<option>Select Op...</option>');
            var type = this.getTypeForOp();
            _.each(opInfo, function(info, i) {
                if (_(info.types).contains(type)) {
                    $('<option>', {value: i}).text(info.opName).appendTo(opSelect);
                }
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
                el: $('<span class="field-input">'),
                negate: this.negate
            });
            this.inputUI.render().$el.appendTo(this.el);
            this.inputUI.on('changed', this.valueChanged, this);
            if (this.spqueryfield.isNew() || this.alreadyCompletedOnce) {
                this.updateSpQueryField();
            }
            this.alreadyCompletedOnce = true;
            this.trigger('completed', this);
        },
        opSelected: function() {
            this.operation = this.$('.op-type').val();
            _(this.negate).isUndefined() || this.update();
        },
        opNegateSelected: function() {
            this.negate = this.$('.op-negate').val() === 'yes';
            _(this.operation).isUndefined() || this.update();
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
            this.value = this.operation = this.negate = undefined;
            this.update();
        },
        valueChanged: function(inputUI, value) {
            this.value = value;
            this.spqueryfield.set('startvalue', value);
        },
        makeTableList: function() {
            var first = [this.model.tableId];
            var rest =  _.chain(this.joinPath).initial().map(function(field) {
                var relatedModel = field.getRelatedModel();
                return relatedModel.name.toLowerCase() === field.name.toLowerCase() ?
                    relatedModel.tableId : (relatedModel.tableId + '-' + field.name.toLowerCase());
            }).value();
            return first.concat(rest).join(',');
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
                isnot: this.negate
            });
        }
    });
});