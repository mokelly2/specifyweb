from specify import models
from specify.api_tests import ApiTests
from ..exceptions import BusinessRuleException

class PicklistTests(ApiTests):
    def test_name_unique_in_collection(self):
        models.Picklist.objects.create(
            collection=self.collection,
            issystem=False,
            name='foobar',
            readonly=False,
            type=0)

        with self.assertRaises(BusinessRuleException):
            models.Picklist.objects.create(
                collection=self.collection,
                issystem=False,
                name='foobar',
                readonly=False,
                type=0)

        models.Picklist.objects.create(
            collection=self.collection,
            issystem=False,
            name='foobaz',
            readonly=False,
            type=0)
