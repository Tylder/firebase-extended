import {
  default as TEST_PROJECT,
  firestoreEmulatorPort,
} from './config';
import {RxFirestoreExtended} from '../rxfirestore-extended';
import {mockDeepItems} from './mock/mockItems';
import firebase from 'firebase/app';
import 'firebase/firestore';

import {SubCollectionWriter} from '../sub-collection-writer';
import {DishItem, RestaurantItem} from './models/restaurant';
import { take, tap} from 'rxjs/operators';
import {forkJoin, Observable, Subscription} from 'rxjs';
import {SubCollectionQuery} from '../sub-collection-query';
import {DocNotExistAction} from '../firestore-extended';
import CollectionReference = firebase.firestore.CollectionReference;
import DocumentReference = firebase.firestore.DocumentReference;
import {createId, isCompleteFirestoreMetadata, isDatesExists} from './utils';
import {FirestoreItem} from '../models/firestoreItem';
import DocumentData = firebase.firestore.DocumentData;

describe('RxFire Firestore Extended Listen', () => {
  let app: firebase.app.App;
  let firestore: firebase.firestore.Firestore;
  let rxFireExt: RxFirestoreExtended;
  let subscription: Subscription;
  let collectionName: string = 'listen'

  /**
   * Each test runs inside it's own app instance and the app
   * is deleted after the test runs.
   *
   * Each test is responsible for seeding and removing data. Helper
   * functions are useful if the process becomes brittle or tedious.
   * Note that removing is less necessary since the test are run
   * against the emulator
   */
  beforeEach(() => {
    console.log('beforeEach outer');
    app = firebase.initializeApp(TEST_PROJECT, createId());
    firestore = app.firestore();
    firestore.useEmulator('localhost', firestoreEmulatorPort);
    rxFireExt = new RxFirestoreExtended(app);  //  initialize RxFireStoreExtended with firestore

    jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000000;
  });

  afterEach(() => {
    console.log('afterEach outer');
    subscription.unsubscribe();
    app.delete().catch();
  });

  afterAll(() => {
    console.log('afterAll outer');
  });

  describe('listenForDoc$', () => {
    let testCollectionRef: CollectionReference;
    let testDocRef: DocumentReference;
    let origData: Readonly<RestaurantItem>;

    const subCollectionWriters: SubCollectionWriter[] = [
      { name: 'reviews' }, // make reviews a sub collection
      { name: 'address' }, // make address a sub collection
      {
        name: 'dishes',  // make dishes a sub collection
        subCollections: [ // sub collection inside a sub collection
          { name: 'images' } // make images a sub collection inside dishes
        ]
      },
    ];

    beforeEach((done: DoneFn) => {
      origData = Object.assign({}, mockDeepItems[0]);
      testCollectionRef = firestore.collection(`${collectionName}_${createId()}`)
      console.log('beforeEach inner, path:', testCollectionRef.path);
      rxFireExt.add$<RestaurantItem>(origData, testCollectionRef, subCollectionWriters, true, ).pipe(
        tap((item) => testDocRef = item.firestoreMetadata.ref),
        take(1)
      ).subscribe(() => done());

    });

    it('single layer', (done: DoneFn) => {
      const subCollectionQueries: SubCollectionQuery[] = []

      testCollectionRef = firestore.collection(`${collectionName}_${createId()}`)

      subscription = rxFireExt.listenForDoc$<RestaurantItem>(testDocRef, subCollectionQueries, DocNotExistAction.RETURN_NULL)
        .pipe(
          take(1),
          tap(d => {

            expect(d).toBeTruthy();
            expect(isDatesExists(d)).toBeTrue()

            expect(d.firestoreMetadata).toBeTruthy();
            expect(isCompleteFirestoreMetadata(d.firestoreMetadata)).toBeTrue()

            expect(d.dishes).toBeFalsy()
            expect(d.reviews).toBeFalsy()

            const cleanData = rxFireExt.cleanExtrasFromData<Partial<RestaurantItem>>(d, subCollectionQueries, ['modifiedDate', 'createdDate'])
            const partialOrigData = Object.assign({}, origData) as Partial<RestaurantItem>

            // since dishes and reviews are saved as separate collections and that is not reflected in subCollectionQueries,
            // they will be missing
            delete partialOrigData.dishes;
            delete partialOrigData.reviews;
            delete partialOrigData.address;

            expect(cleanData).toEqual(partialOrigData)
          }),
        ).subscribe(() => done());
    });

    it('deep', (done: DoneFn) => {
      const subCollectionQueries: SubCollectionQuery[] = [
        { name: 'reviews' },
        { name: 'address' }, // make address a sub collection
        { // add dishes sub Collection to restaurant object
          name: 'dishes',
          queryFn: ref => ref.orderBy('index'),
          subCollections: [
            { name: 'images' } // add images sub Collection to dish object
          ]
        },
      ];

      subscription = rxFireExt.listenForDoc$<RestaurantItem>(testDocRef, subCollectionQueries, DocNotExistAction.RETURN_NULL)
        .pipe(
          take(1),
          tap(d => {

            expect(d).toBeTruthy();
            expect(isDatesExists(d)).toBeTrue()

            expect(d.firestoreMetadata).toBeTruthy();
            expect(isCompleteFirestoreMetadata(d.firestoreMetadata)).toBeTrue()

            // cannot do a toEqual between origData and d because the different array will not be in the correct order.
            // later we will have a test that test order as well

            expect(d.dishes[0].firestoreMetadata).toBeTruthy();
            expect(d.reviews[0].firestoreMetadata).toBeTruthy();
            expect(d.dishes[0].images[0].firestoreMetadata).toBeTruthy();

            // testing orderBy query
            d.dishes.forEach((dish, i) => {
              expect(dish.index).toEqual(i)
            })

            expect(d.dishes.length).toEqual(origData.dishes.length)
            expect(d.reviews.length).toEqual(origData.reviews.length)
            expect(d.dishes[0].images.length).toEqual(origData.dishes[0].images.length)

            const cleanData = rxFireExt.cleanExtrasFromData<RestaurantItem>(d, subCollectionQueries, ['modifiedDate', 'createdDate']);

            expect(cleanData.address).toEqual(origData.address);
            expect(cleanData.reviews).toEqual(jasmine.arrayWithExactContents(origData.reviews))
            expect(cleanData.dishes[0].images).toEqual(jasmine.arrayWithExactContents(origData.dishes[0].images))
          }),
        ).subscribe(() => done());
    });
  });

  describe('listenForCollection$', () => {
    let testCollectionRef: CollectionReference;

    const origData = mockDeepItems.map(x => Object.assign({}, x));

    const subCollectionWriters: SubCollectionWriter[] = [
      { name: 'reviews' }, // make reviews a sub collection
      {
        name: 'dishes',  // make dishes a sub collection
        subCollections: [ // sub collection inside a sub collection
          { name: 'images' } // make images a sub collection inside dishes
        ]
      },
    ];

    beforeEach((done: DoneFn) => {

      testCollectionRef = firestore.collection(`${collectionName}_${createId()}`)
      console.log('beforeEach inner ', testCollectionRef.path);
      const observableList: Observable<any>[] = [];

      origData.forEach(item => {
        const obs = rxFireExt.add$<RestaurantItem>(item, testCollectionRef, subCollectionWriters, true, item.name);

        observableList.push(obs);
      })
      forkJoin(observableList).pipe(
        take(1)
      ).subscribe(() => done());
    });


    it('single layer', (done: DoneFn) => {
      const subCollectionQueries: SubCollectionQuery[] = [];

      console.log('single')

      subscription = rxFireExt.listenForCollection$<RestaurantItem>(testCollectionRef, subCollectionQueries)
        .pipe(
          take(1),
          tap((datas) => {

            expect(datas).toBeTruthy();
            expect(datas.length).toEqual(origData.length);

            datas.forEach(d => {
              expect(d).toBeTruthy();
              expect(isDatesExists(d)).toBeTrue()
              expect(isCompleteFirestoreMetadata(d.firestoreMetadata)).toBeTrue()

              expect(d.dishes).toBeFalsy()
              expect(d.reviews).toBeFalsy()
            })

            // since the data should be shallow

            let partialOrigData = origData.map(x => Object.assign({}, x)) as Partial<RestaurantItem>[];

            partialOrigData = partialOrigData.map(d => {
              const partial = d as Partial<RestaurantItem>;
              delete partial.dishes;
              delete partial.reviews;

              return partial;
            })

            const cleanDatas = rxFireExt.cleanExtrasFromData<Partial<RestaurantItem>>(datas, subCollectionQueries, ['modifiedDate', 'createdDate'])
            expect(cleanDatas).toEqual(jasmine.arrayWithExactContents(partialOrigData))
          }),
        ).subscribe(() => done());
    });

    it('deep', (done: DoneFn) => {
      const subCollectionQueries: SubCollectionQuery[] = [
        {
          name: 'reviews',
        },
        {
          name: 'dishes',
          subCollections: [
            { name: 'images' }
          ]
        },
      ];

      subscription = rxFireExt.listenForCollection$<RestaurantItem>(testCollectionRef, subCollectionQueries)
        .pipe(
          take(1),
          tap(datas => {

            expect(datas).toBeTruthy();
            expect(datas.length).toEqual(origData.length);

            datas.forEach(d => {
              expect(d).toBeTruthy();
              expect(isDatesExists(d)).toBeTrue()
              expect(isCompleteFirestoreMetadata(d.firestoreMetadata)).toBeTrue()

              expect(d.dishes).toBeTruthy()
              expect(d.reviews).toBeTruthy()

              const matchingOrigData = origData.find(origD => d.name === origD.name) as RestaurantItem;
              const cleanD = rxFireExt.cleanExtrasFromData<Partial<RestaurantItem>>(d, subCollectionQueries, ['modifiedDate', 'createdDate'])

              expect(cleanD.reviews).toEqual(jasmine.arrayWithExactContents(matchingOrigData.reviews))

              // cannot simply compare dishes
              cleanD.dishes?.forEach(dish => {
                const matchingOrigDish = matchingOrigData.dishes.find(origDish => dish.name === origDish.name) as DishItem;
                expect(dish.images).toEqual(jasmine.arrayWithExactContents(matchingOrigDish.images))
              });
            })
          }),
        ).subscribe(() => done());
    });


    it('deep trying to read non existing collections', (done: DoneFn) => {

      testCollectionRef = firestore.collection(`${collectionName}_nonExisting`)

      subscription = rxFireExt.listenForCollection$<RestaurantItem>(testCollectionRef).pipe(
       take(1),
       tap(datas => {
         expect(datas.length).toEqual(0);
       })
      ).subscribe(() => done());
    });


    it('deep trying to read non existing sub collections', (done: DoneFn) => {
      const subCollectionQueries: SubCollectionQuery[] = [
        {
          name: 'reviews',
        },
        {
          name: 'dishes',
          subCollections: [
            { name: 'images' }
          ]
        },
        {
          name: 'nonExistingCollection',
        },
      ];

      subscription = rxFireExt.listenForCollection$<RestaurantItem>(testCollectionRef, subCollectionQueries).pipe(
        take(1),
        tap(datas => {

          expect(datas).toBeTruthy();
          expect(datas.length).toEqual(origData.length);

          datas.forEach(d => {
            expect(d).toBeTruthy();
            expect(isDatesExists(d)).toBeTrue()
            expect(isCompleteFirestoreMetadata(d.firestoreMetadata)).toBeTrue()

            expect(d.dishes).toBeTruthy()
            expect(d.reviews).toBeTruthy()

            expect((d as DocumentData).nonExistingCollection).toBeTruthy()
            expect((d as DocumentData).nonExistingCollection.length).toEqual(0)

            const matchingOrigData = origData.find(origD => d.name === origD.name) as RestaurantItem;
            const cleanD = rxFireExt.cleanExtrasFromData<Partial<RestaurantItem>>(d, subCollectionQueries, ['modifiedDate', 'createdDate'])

            expect(cleanD.reviews).toEqual(jasmine.arrayWithExactContents(matchingOrigData.reviews))

            // cannot simply compare dishes
            cleanD.dishes?.forEach(dish => {
              const matchingOrigDish = matchingOrigData.dishes.find(origDish => dish.name === origDish.name) as DishItem;
              expect(dish.images).toEqual(jasmine.arrayWithExactContents(matchingOrigDish.images))
            });

          })
        })
      ).subscribe(() => done());
    });
  });

});
