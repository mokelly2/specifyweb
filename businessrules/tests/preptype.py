from django.db.models import ProtectedError
from specify import models
from specify.api_tests import ApiTests
from ..exceptions import BusinessRuleException

class PrepTypeTests(ApiTests):
    def test_delete_blocked_by_preparation(self):
        preptype = models.Preptype.objects.create(
            collection=self.collection,
            name='mummified',
            isloanable=True)

        collectionobject = models.Collectionobject.objects.create(
            collection=self.collection,
            collectionmemberid=self.collection.id)

        prep = collectionobject.preparations.create(
            collectionmemberid=collectionobject.collectionmemberid,
            preptype=preptype)

        with self.assertRaises(ProtectedError):
            preptype.delete()

        prep.delete()
        preptype.delete()

    def test_name_unique_in_collection(self):
        models.Preptype.objects.create(
            collection=self.collection,
            name='foobar',
            isloanable=True)

        with self.assertRaises(BusinessRuleException):
            models.Preptype.objects.create(
                collection=self.collection,
                name='foobar',
                isloanable=True)

        models.Preptype.objects.create(
            collection=self.collection,
            name='foobaz',
            isloanable=True)
