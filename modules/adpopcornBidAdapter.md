# Overview

```
Module Name: IGAWorks Adpopcorn Bidder Adapter
Module Type: Bidder Adapter
Maintainer: ap_dev@igaworks.com
```

# Description

Connect to IGAWorks adpopcorn's exchange for bids.  
Banner formats are supported.       
The adpopcorn adapter doesn't support multiple sizes per ad-unit and will use the first one if multiple sizes are defined.      

# Test Parameters

```js
var adUnits = [
    {
        code: 'div-igaw-ad-tqe74fmf6qg63cq',
        mediaTypes: {
            banner: {
                sizes: [[300, 250]]
            }
        },
        bids: [
            {
                bidder: 'adpopcorn',
                params: {
                    publisherId: '265510060',
                    placementId: 'tqe74fmf6qg63cq'
                }
            }
        ]
    }
];
```
