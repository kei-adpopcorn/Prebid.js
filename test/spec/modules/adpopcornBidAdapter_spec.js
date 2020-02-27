import { expect } from 'chai';
import { spec } from 'modules/adpopcornBidAdapter.js';
import { newBidder } from 'src/adapters/bidderFactory.js';

describe('adpopcornAdapterTests', function() {
  const adapter = newBidder(spec);

  describe('inherited functions', function () {
    it('exists and is a function', function () {
      expect(adapter.callBids).to.exist.and.to.be.a('function');
    });
  });

  describe('isBidRequestValid', function() {
    let bid = {
      adUnitCode: 'adunit-code',
      bidder: 'adpopcorn',
      params: {
        publisherId: '12345',
        placementId: '23456',
      },
      mediaTypes: {
        banner: {
          sizes: [[300, 250]]
        }
      },
      bidId: '30b31c1838de1e',
      bidderRequestId: '22edbae2733bf6',
      auctionId: '1d1a030790a475',
    };

    it('should return true if a bid is valid banner bid request', function() {
      expect(spec.isBidRequestValid(bid)).to.be.equal(true);
    });

    it('should return false where requried param is missing', function() {
      let bid = Object.assign({}, bid);
      bid.params = {};
      expect(spec.isBidRequestValid(bid)).to.be.equal(false);
    });

    it('should return false when required param values have invalid type', function() {
      let bid = Object.assign({}, bid);
      bid.params = {
        publisherId: '',
        placementId: '',
      };
      expect(spec.isBidRequestValid(bid)).to.be.equal(false);
    });
  });

  describe('buildRequests', function() {
    it('should return an empty list  if there are no bid requests', function() {
      const fakeBidRequests = [];
      const fakeBidderRequest = {};
      expect(spec.buildRequests(fakeBidRequests, fakeBidderRequest)).to.be.an('array').that.is.empty;
    });

    it('should generate a POST bid request with method, url, and data fields', function() {
      const bid = {
        adUnitCode: 'adunit-code',
        bidder: 'adpopcorn',
        params: {
          publisherId: '12345',
          placementId: '23456',
        },
        mediaTypes: {
          banner: {
            sizes: [[300, 250]]
          }
        },
        bidId: '30b31c1838de1e',
        bidderRequestId: '22edbae2733bf6',
        auctionId: '1d1a030790a475',
      };
      const fakeBidRequests = [bid];
      const fakeBidderRequest = {
        refererInfo: {
          referer: 'fakeReferer',
          reachedTop: true,
          numIframes: 1,
          stack: [],
        },
      };

      const builtRequests = spec.buildRequests(fakeBidRequests, fakeBidderRequest);
      expect(builtRequests.length).to.equal(1);
      expect(builtRequests[0].method).to.equal('POST');
      expect(builtRequests[0].url).match(/sspi-web-request\.adpopcorn\.com\/v1\/rev1\/banner/);
      expect(builtRequests[0].bidId).to.equal('30b31c1838de1e');

      const data = builtRequests[0].data;
      expect(data.publisherId).to.equal('12345');
      expect(data.placementId).to.equal('23456');
      expect(data.bcat).to.be.an('array').that.is.empty;
      expect(data.adid).to.exist.and.to.be.a('string');
      expect(data.ua).to.exist.and.to.be.a('string');
      expect(Object.keys(data.device)).to.have.lengthOf(1);
      expect(Object.keys(data.os)).to.have.lengthOf(2);
      expect(Object.keys(data.browser)).to.have.lengthOf(4);
      expect(data.bannerSize).to.equal('300x250');
      expect(data.site).deep.equal({
        domain: 'localhost',
        url: 'http://localhost:9876/fakeReferer',
        referrer: '',
      });
      expect(data.version).deep.equal({
        pbjs: '$prebid.version$',
        adapter: '1.0.0',
      });
    });
  });

  describe('interpretResponse', function() {
    const fakeBidRequest = {
      adUnitCode: 'adunit-code',
      bidder: 'adpopcorn',
      params: {
        publisherId: '12345',
        placementId: '23456',
      },
      mediaTypes: {
        banner: {
          sizes: [[300, 250]]
        }
      },
      bidId: '30b31c1838de1e',
      bidderRequestId: '22edbae2733bf6',
      auctionId: '1d1a030790a475',
    };

    it('should return an empty aray to indicate no valid bids', function() {
      const fakeServerResponse = {};
      const bidResponses = spec.interpretResponse(fakeServerResponse, fakeBidRequest);

      expect(bidResponses).is.an('array').that.is.empty;
    });

    it('should generate correct response array for bidder', function() {
      const fakeBidResult = {
        AdList: [
          {
            ClickTrackersList: [],
            ImpTrackersList: [],
            WinNoticeList: [],
            adm: '<h3>fake html</h3>',
            width: 300,
            height: 250,
            bid_price: 3.5754,
            bid_type: 2,
            bid_currency: 'USD',
            creative_id: '123abc',
          }
        ],
        IsTest: true,
        Mediation: [],
        Result: true,
        ResultCode: 1,
        ResultMsg: 'Success',
      };
      const fakeServerResponse = {
        headers: {},
        body: fakeBidResult,
      };
      const bidResponses = spec.interpretResponse(fakeServerResponse, fakeBidRequest);

      expect(bidResponses.length).to.equal(1);
      expect(bidResponses[0].requestId).to.equal('30b31c1838de1e');
      expect(bidResponses[0].ad).to.not.be.empty;
      expect(bidResponses[0].cpm).to.equal(3.5754);
      expect(bidResponses[0].creativeId).to.equal('123abc');
      expect(bidResponses[0].currency).to.equal('USD');
      expect(bidResponses[0].width).to.equal(300);
      expect(bidResponses[0].height).to.equal(250);
      expect(bidResponses[0].netRevenue).to.be.true;
      expect(bidResponses[0].ttl).to.equal(60);
    });
  });
});
