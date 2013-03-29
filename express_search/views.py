import re
from datetime import date, datetime
from xml.etree import ElementTree

from django.db.models import Q
from django.http import HttpResponse
from django.views.decorators.http import require_GET
from django.contrib.auth.decorators import login_required

from specify import models
from specify.filter_by_col import filter_by_collection
from specify.api import toJson

from context.app_resource import get_app_resource

QUOTED_STR_RE = re.compile(r'^([\'"`])(.*)\1$')

class Term:
    discipline = None
    def __init__(self, term):
        self.is_suffix = term.startswith('*')
        self.is_prefix = term.endswith('*')
        self.term = term.strip('*')

        try:
            float(self.term)
            self.is_number = True
        except ValueError:
            self.is_number = False

        try:
            self.maybe_year = 1000 <= int(self.term) <= date.today().year
            self.is_integer = True
        except ValueError:
            self.maybe_year = self.is_integer = False

        try:
            self.as_date = datetime.strptime(self.term, '%m/%d/%Y').date()
        except ValueError:
            self.as_date = None

    def create_filter(self, field):
        filter_map = {
            'DateField': self.create_date_filter,
            'DateTimeField': self.create_date_filter,
            'CharField': self.create_text_filter,
            'TextField': self.create_text_filter,
            'IntegerField': self.create_integer_filter,
            'FloatField': self.create_float_filter,
            'DecimalField': self.create_float_filter,}

        create = filter_map.get(field.__class__.__name__, lambda f: None)
        return create(field)

    def create_text_filter(self, field):
        if self.discipline:
            from specify.models import Splocalecontaineritem
            args = dict(
                container__schematype=0, # core schema
                container__discipline=self.discipline,
                name__iexact=field.name,
                container__name__iexact=field.model.__name__)
            print args
            fieldinfo = Splocalecontaineritem.objects.get(**args)
            if fieldinfo.format == 'CatalogNumberNumeric':
                if not self.is_integer: return None
                term = "%.9d" % int(self.term)
                return Q(**{ field.name: term })

        if self.is_prefix and self.is_suffix:
            op = '__icontains'
        elif self.is_prefix:
            op = '__istartswith'
        elif self.is_suffix:
            op = '__iendswith'
        else:
            op = '__iexact'
        return Q(**{ field.name + op: self.term })

    def create_integer_filter(self, field):
        if not self.is_integer: return None
        return Q(**{ field.name: int(self.term) })

    def create_date_filter(self, field):
        if self.maybe_year:
            return Q(**{ field.name + '__year': int(self.term) })

        if not self.as_date: return None
        return Q(**{ field.name: self.as_date })

    def create_float_filter(self, field):
        if not self.is_number: return None
        return Q(**{ field.name: float(self.term) })

def parse_search_str(collection, search_str):
    class TermForCollection(Term):
        discipline = collection.discipline

    match_quoted = QUOTED_STR_RE.match(search_str)
    if match_quoted:
        terms = [ match_quoted.groups()[1] ]
    else:
        terms = search_str.split()

    return map(TermForCollection, terms)

def build_queryset(searchtable, terms, collection):
    tablename = searchtable.find('tableName').text.capitalize()
    model = getattr(models, tablename)

    fields = [model._meta.get_field(fn.text.lower())
              for fn in searchtable.findall('.//searchfield/fieldName')]

    filters = [filtr
               for filtr in [
                   term.create_filter(field)
                   for term in terms
                   for field in fields]
               if filtr is not None]

    if len(filters) > 0:
        reduced = reduce(lambda p, q: p | q, filters)
        return filter_by_collection(model.objects.filter(reduced), collection)

def get_express_search_config(request):
    resource, __ = get_app_resource(request.specify_collection,
                                    request.specify_user,
                                    'ExpressSearchConfig')
    return ElementTree.XML(resource)

@require_GET
@login_required
def search(request):
    express_search_config = get_express_search_config(request)
    terms = parse_search_str(request.specify_collection, request.GET['q'])
    specific_table = request.GET.get('name', None)

    def do_search(tablename, searchtable):
        qs = build_queryset(searchtable, terms, request.specify_collection)
        if not qs:
            return dict(totalCount=0, results=[])

        display_fields = [fn.text.lower() \
                              for fn in searchtable.findall('.//displayfield/fieldName')]
        display_fields.append('id')
        qs = qs.values(*display_fields).order_by('id')
        total_count = qs.count()

        if specific_table is not None and 'last_id' in request.GET:
            qs = qs.filter(id__gt=request.GET['last_id'])

        return dict(totalCount=total_count, results=list(qs[:10]))

    data = dict((tablename, do_search(tablename, searchtable))
                for searchtable in express_search_config.findall('tables/searchtable')
                for tablename in [ searchtable.find('tableName').text.capitalize() ]
                if specific_table is None or tablename == specific_table)

    return HttpResponse(toJson(data), content_type='application/json')

@require_GET
@login_required
def related_search(request):
    import related_searches
    express_search_config = get_express_search_config(request)
    rs = getattr(related_searches, request.GET['name'])()
    model = rs.pivot()
    for searchtable in express_search_config.findall('tables/searchtable'):
        tablename = searchtable.find('tableName').text.capitalize()
        if tablename == model.__name__: break
    else:
        raise Exception('no matching primary search for related search: ' + rs)

    terms = parse_search_str(request.specify_collection, request.GET['q'])
    qs = build_queryset(searchtable, terms, request.specify_collection)
    results = rs.do_search(qs, request.GET.get('last_id', None))
    return HttpResponse(toJson(results), content_type='application/json')
