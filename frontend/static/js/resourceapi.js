define([
    'jquery', 'underscore', 'backbone', 'schema', 'whenall', 'jquery-bbq'
], function($, _, Backbone, schema, whenAll) {
    var api = _.extend({}, Backbone.Events);

    function isResourceOrCollection(obj) { return obj instanceof Resource || obj instanceof Collection; }

    function eventHandlerForToOne(related, field) {
        return function(event) {
            var args = _.toArray(arguments);
            switch (event) {
            case 'saverequired':
                if (related.dependent) this.needsSaved = true;
                else args[0] = 'subsaverequired';
            case 'subsaverequired':
                return this.trigger.apply(this, args);
                break;
            case 'change:id':
                this.set(field.name, related.url());
                break;
            }

            // pass change:field events up the tree, updating fields with dot notation
            var match = /^r?(change):(.*)$/.exec(event);
            if (match) {
                args[0] = 'r' + match[1] + ':' + field.name.toLowerCase() + '.' + match[2];
                this.trigger.apply(this, args);
            }
        };
    }

    function eventHandlerForToMany(related, field) {
        return function(event) {
            var args = _.toArray(arguments);
            switch (event) {
            case 'saverequired':
                if (related.dependent) this.needsSaved = true;
                else args[0] = 'subsaverequired';
            case 'subsaverequired':
                // propagate the above events up the object tree
                this.trigger.apply(this, args);
                break;
            case 'add':
            case 'remove':
                // annotate add and remove events with the field in which they occured
                var args = _(arguments).toArray();
                args[0] = event + ':' + field.name.toLowerCase();
                this.trigger.apply(this, args);
                break;
            }};
    }

    api.Resource = Backbone.Model.extend({
        populated: false,   // indicates if this resource has data
        _fetch: null,       // stores reference to the ajax deferred while the resource is being fetched
        needsSaved: false,  // set when a local field is changed
        _save: null,        // stores reference to the ajax deferred while the resource is being saved
        dependent: false,   // set when resource is a related to it parent by a dependent field

        constructor: function(attributes, options) {
            this.specifyModel = this.constructor.specifyModel;
            this.relatedCache = {};   // references to related objects referred to by field in this resource
            Backbone.Model.apply(this, arguments);
        },
        initialize: function(attributes, options) {
            // if initialized with some attributes that include a resource_uri,
            // assume that represents all the fields for the resource
            if (attributes && _(attributes).has('resource_uri')) this.populated = true;

            // the resource needs to be saved if any of its fields change
            // unless they change because the resource is being fetched
            // or updated during a save
            this.on('change', function(resource, options) {
                if (!this._fetch && !this._save) {
                    this.needsSaved = true;
                    this.trigger('saverequired');
                }
            });

            // if the id of this resource changes, we go through and update
            // all the objects that point to it with the new pointer.
            // this is to support having collections of objects attached to
            // newly created resources that don't have ids yet. when the
            // resource is saved, the related objects can have their FKs
            // set correctly.
            this.on('change:id', function() {
                var resource = this;
                _(resource.relatedCache).each(function(related, fieldName) {
                    var field = resource.specifyModel.getField(fieldName);
                    if(field.type === 'one-to-many') {
                        _.chain(related.models).compact().invoke(
                            'set', field.otherSideName, resource.url());
                    }
                });

                // TODO: set value on parent object if necessary
            });

            api.trigger('initresource', this);
            if (this.isNew()) api.trigger('newresource', this);
        },
        clone: function() {
            var self = this;
            var newResource = Backbone.Model.prototype.clone.call(self);
            newResource.needsSaved = self.needsSaved;
            newResource.dependent = self.dependent;
            newResource.recordsetid = self.recordsetid;

            _.each(self.relatedCache, function(related, fieldName) {
                var field = self.specifyModel.getField(fieldName);
                switch (field.type) {
                case 'many-to-one':
                    break;
                case 'one-to-many':
                    newResource.rget(fieldName).done(function(newCollection) {
                        related.each(function(resource) { newCollection.add(resource); });
                    });
                    break;
                case 'zero-to-one':
                    newResource.set(fieldName, related);
                    break;
                default:
                    throw new Error('unhandled relationship type');
                }
            });
            return newResource;
        },
        logAllEvents: function() {
            this.on('all', function() {
                console.log(arguments);
            });
        },
        url: function() {
            // returns the api uri for this resource. if the resource is newly created
            // (no id), return the uri for the collection it belongs to
            var url = '/api/specify/' + this.specifyModel.name.toLowerCase() + '/' +
                (!this.isNew() ? (this.id + '/') : '');
            return $.param.querystring(url, {recordsetid: this.recordsetid});
        },
        viewUrl: function() {
            // returns the url for viewing this resource in the UI
            var url = '/specify/view/' + this.specifyModel.name.toLowerCase() + '/' + (this.id || 'new') + '/';
            return $.param.querystring(url, {recordsetid: this.recordsetid});
        },
        get: function(attribute) {
            // case insensitive
            return Backbone.Model.prototype.get.call(this, attribute.toLowerCase());
        },
        setToOneCache: function(field, related) {
            var self = this;

            var oldRelated = self.relatedCache[field.name.toLowerCase()];
            if (!related) {
                oldRelated && oldRelated.off("all", null, this);
                delete self.relatedCache[field.name.toLowerCase()];
                return;
            }

            if (oldRelated && oldRelated.cid === related.cid) return;

            oldRelated && oldRelated.off("all", null, this);

            related.on('all', eventHandlerForToOne(related, field), self);
            related.parent = self;
            related.dependent = field.isDependent();

            switch (field.type) {
            case 'one-to-one':
            case 'many-to-one':
                self.relatedCache[field.name.toLowerCase()] = related;
                break;
            case 'zero-to-one':
                self.relatedCache[field.name.toLowerCase()] = related;
                related.set(field.otherSideName, self.url());
                break;
            default:
                throw new Error("setToOneCache: unhandled field type: " + field.type);
            }
        },
        set: function(key, value, options) {
            // make the keys case insensitive
            var attrs = {}, self = this;
            if (_.isObject(key) || key == null) {
                _(key).each(function(value, key) { attrs[key.toLowerCase()] = value; });
                options = value;
            } else {
                attrs[key.toLowerCase()] = value;
            }

            // need to set the id right way, if we have it because
            // relationships depend on it
            if ('id' in attrs) self.id = attrs.id;

            _.each(attrs, function(value, fieldName) {
                var field = self.specifyModel.getField(fieldName);
                if (!field || !field.isRelationship) return;

                var relatedModel = field.getRelatedModel();

                var oldRelated = self.relatedCache[fieldName];
                if (_.isString(value)) {
                    if (oldRelated && field.type ===  'many-to-one') {
                        if (oldRelated.url() !== value) {
                            delete self.relatedCache[fieldName];
                            oldRelated.off('all', null, this);
                        }
                    }
                } else {
                    switch (field.type) {
                    case 'one-to-many':
                        self.setToManyCache(field, new (api.Collection.forModel(relatedModel))(value, {parse: true}));
                        delete attrs[fieldName];
                        return;
                    case 'many-to-one':
                        if (!value) {
                            self.setToOneCache(field, value);
                            return;
                        }

                        value = (value instanceof api.Resource) ? value :
                            new (self.constructor.forModel(relatedModel))(value, {parse: true});

                        self.setToOneCache(field, value);
                        attrs[fieldName] = self.relatedCache[fieldName].url();
                        return;
                    case 'zero-to-one':
                        if (_.isArray(value)) {
                            value = (value.length < 1) ? null :
                                new (self.constructor.forModel(relatedModel))(_.first(value), {parse: true});
                        }
                        self.setToOneCache(field, value);
                        delete attrs[fieldName];
                        return;
                    }
                }
            });
            return Backbone.Model.prototype.set.call(this, attrs, options);
        },
        setToManyCache: function(field, toMany) {
            var self = this;
            // set the back ref
            toMany.parent = self;
            toMany.dependent = field.isDependent();
            if (!self.isNew()) {
                // filter the related objects to be those that have a FK to this resource
                toMany.queryParams[field.otherSideName.toLowerCase()] = self.id;
            } else {
                // if this resource has no id, we can't set up the filter yet.
                // we'll set a flag to indicate this collection represents a set
                // of related objects for a new resource
                toMany.isNew = true;
            }

            var oldToMany = self.relatedCache[field.name.toLowerCase()];
            oldToMany && oldToMany.off("all", null, this);

            // cache it and set up event handlers
            self.relatedCache[field.name.toLowerCase()] = toMany;
            toMany.on('all', eventHandlerForToMany(toMany, field), self);
        },
        rget: function(fieldName, prePop) {
            // get the value of the named field where the name may traverse related objects
            // using dot notation. if the named field represents a resource or collection,
            // then prePop indicates whether to return the named object or the contents of
            // the field that represents it
            var self = this;
            // first make sure we actually have this object.
            return this.fetchIfNotPopulated().pipe(function() {
                var path = _(fieldName).isArray()? fieldName : fieldName.split('.');
                fieldName = path[0].toLowerCase();
                var field = self.specifyModel.getField(fieldName);
                var value = self.get(fieldName);

                // if field represents a value, then return that if we are done,
                // otherwise we can't traverse any farther...
                if (!field || !field.isRelationship) return path.length === 1 ? value : undefined;

                var related = field.getRelatedModel();
                switch (field.type) {
                case 'one-to-one':
                case 'many-to-one':
                    // a foreign key field.
                    if (!value) return value;  // no related object

                    // is the related resource cached?
                    var toOne = self.relatedCache[fieldName];
                    if (!toOne) {
                        toOne = self.constructor.fromUri(value);
                        self.setToOneCache(field, toOne);
                    }
                    // if we want a field within the related resource then recur
                    // otherwise, start the resource fetching if prePop and return
                    return (path.length > 1) ? toOne.rget(_.tail(path), prePop) : (
                        prePop ? toOne.fetchIfNotPopulated() : toOne
                    );
                case 'one-to-many':
                    // can't traverse into a collection using dot notation
                    if (path.length > 1) return undefined;

                    // is the collection cached?
                    var toMany =  self.relatedCache[fieldName];
                    if (!toMany) {
                        // value might not exist if resource is null, or the server didn't send it.
                        // since the URI is implicit in the data we have, it doesn't matter.
                        toMany = value ? api.Collection.fromUri(value) : new (api.Collection.forModel(related))();
                        self.setToManyCache(field, toMany);
                    }

                    // start the fetch if requested and return the collection
                    return prePop ? toMany.fetchIfNotPopulated() : toMany;
                case 'zero-to-one':
                    // this is like a one-to-many where the many cannot be more than one
                    // i.e. the current resource is the target of a FK

                    // is it already cached?
                    if (self.relatedCache[fieldName]) {
                        value = self.relatedCache[fieldName];
                        // recur if we need to traverse more
                        return (path.length === 1) ? value : value.rget(_.tail(path), prePop);
                    }

                    // if this resource is not yet persisted, the related object can't point to it yet
                    if (self.isNew()) return undefined;

                    // it is a uri pointing to the collection
                    // that contains the resource
                    var collection = api.Collection.fromUri(value);

                    // fetch the collection and pretend like it is a single resource
                    return collection.fetchIfNotPopulated().pipe(function() {
                        var value = collection.isEmpty() ? null : collection.first();
                        self.setToOneCache(field, value);
                        return (path.length === 1) ? value : value.rget(_.tail(path), prePop);
                    });
                }
            });
        },
        save: function() {
            var resource = this;
            if (resource._save) {
                throw new Error('resource is already being saved');
            }
            var didNeedSaved = resource.needsSaved;
            resource.needsSaved = false;

            resource._save = Backbone.Model.prototype.save.apply(resource, arguments);

            resource._save.fail(function() {
                resource._save = null;
                resource.needsSaved = didNeedSaved;
                didNeedSaved && resource.trigger('saverequired');
            }).then(function() {
                resource._save = null;
            });

            return resource._save;
        },
        rsave: function() {
            // descend the object tree and save everything that needs it
            var resource = this;
            if (resource._save) {
                throw new Error('resource is already being saved');
            }

            var isToOne = function(related, fieldName) {
                var field = resource.specifyModel.getField(fieldName);
                return field.type === 'many-to-one' && !related.dependent;
            };
            var isToMany = function(related, fieldName) {
                var field = resource.specifyModel.getField(fieldName);
                return _(['one-to-many', 'zero-to-one']).contains(field.type) && !related.dependent;
            };
            var saveIfExists = function(related) { return related && related.rsave(); };

            var saveIf = function(pred) {
                return _.chain(resource.relatedCache).filter(pred).map(saveIfExists).value();
            };

            var saveResource = function() {
                return resource.needsSaved && resource.save();
            };

            return whenAll(saveIf(isToOne)).pipe(function() {
                return $.when(saveResource()).pipe(function() {
                    return whenAll(saveIf(isToMany));
                });
            });
        },
        toJSON: function() {
            var self = this;
            var json = Backbone.Model.prototype.toJSON.apply(self, arguments);

            _.each(self.relatedCache, function(related, fieldName) {
                var field = self.specifyModel.getField(fieldName);

                if (related.dependent) {
                    var relatedData = field.type === 'zero-to-one' ? [related.toJSON()] : related.toJSON() ;
                    json[fieldName] = relatedData;
                }
            });
            return json;
        },
        fetch: function(options) {
            // cache a reference to the ajax deferred and don't start fetching if we
            // already are.
            var resource = this;

            if (resource._fetch) return resource._fetch;
            return resource._fetch = Backbone.Model.prototype.fetch.call(this, options).done(function() {
                resource._fetch = null;
            });
        },
        fetchIfNotPopulated: function() {
            var resource = this;
            // if already populated, return the resource
            if (resource.populated) return $.when(resource);

            // if can't be populate by fetching, return the resource
            if (resource.isNew()) return $.when(resource);

            // fetch and return a deferred.
            return resource.fetch().pipe(function() { return resource; });
        },
        parse: function(resp) {
            // since we are putting in data, the resource in now populated
            this.populated = true;
            if (resp.id) resp.id = parseInt(resp.id, 10);
            return Backbone.Model.prototype.parse.apply(this, arguments);
        },
        getRelatedObjectCount: function(fieldName) {
            // return the number of objects represented by a to-many field
            if (this.specifyModel.getField(fieldName).type !== 'one-to-many') {
                throw new TypeError('field is not one-to-many');
            }

            // for unpersisted objects, this function doesn't make sense
            if (this.isNew()) return $.when(undefined);

            return this.rget(fieldName).pipe(function (collection) {
                if (!collection) return 0;
                return collection.getTotalCount();
            });
        },
        sync: function(method, resource, options) {
            options = options || {};
            switch (method) {
            case 'delete':
                // when deleting we don't send any data so put the version in a header
                options.headers = {'If-Match': resource.get('version')};
                break;
            case 'create':
                // use the special recordSetId field to add the resource to a record set
                if (!_.isUndefined(resource.recordSetId)) {
                    options.url = $.param.querystring(
                        options.url || resource.url(),
                        {recordsetid: resource.recordSetId});
                }
                break;
            }
            return Backbone.sync(method, resource, options);
        },
        onChange: function(fieldName, callback) {
            // bind a callback to the change event for the named field
            var fieldName = fieldName.toLowerCase();
            var event = fieldName.split('.').length === 1 ? 'change:' : 'rchange:';
            this.on(event + fieldName, function(resource, value) { callback(value); });
        },
        placeInSameHierarchy: function(other) {
            var self = this;
            var myPath = self.specifyModel.orgPath();
            var otherPath = other.specifyModel.orgPath();
            if (!myPath || !otherPath) return;
            if (myPath.length > otherPath.length) return;
            var diff = _(otherPath).rest(myPath.length - 1).reverse();
            return other.rget(diff.join('.')).done(function(common) {
                self.set(_(diff).last(), common.url());
            });
        }
    }, {
        forModel: function(model) {
            // given a model name or object, return a constructor for resources of that type
            var model = _(model).isString() ? schema.getModel(model) : model;
            if (!model) return null;

            if (!_(resources).has(model.name)) {
                resources[model.name] = api.Resource.extend({}, { specifyModel: model });
            }
            return resources[model.name];
        },
        fromUri: function(uri) {
            // given a resource uri, find the appropriate constructor and instantiate
            // a resource object representing the resource. will not be populated.
            var match = /api\/specify\/(\w+)\/(\d+)\//.exec(uri);
            var ResourceForModel = api.Resource.forModel(match[1]);
            return new ResourceForModel({id: parseInt(match[2], 10) });
        },
        collectionFor: function() {
            // return the collection constructor for this type of resource
            return api.Collection.forModel(this.specifyModel);
        }
    });

    var resources = {};

    return api;
});
