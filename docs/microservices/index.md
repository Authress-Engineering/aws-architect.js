# Microservices benefit

Microservices are designed to implement business logic in a straigtforward way.  Take your business logic deploy to production.  Altough there are easier and faster methods, microservices architecture gives one additionaly benefit--scale.  Maintenance and cost of ownership of microservices are greatly reduced, and if prepared to write microservices, teams will gain unlimited benefit of delivering value in more reliable way.

### Create microservices 

* [How to use continuous integration](https://github.com/wparad/Continuous-Integration)

### Microservice architecture
Let's start by just deconstructing what a microservice looks like.  When thinking about microservices, making sure to separate concerns has a huge importance.  Following single responsibility princible or [SRP](https://en.wikipedia.org/wiki/Single_responsibility_principle), allows for each component to scale as needed.

The major components of a service include:

* Persistent data store (sql/nosql database)
* HTTP RESTful interface
* Controller (or HTTP API mapping)
* Business Logic functions (actual code)
* Authentication (user management and access control)
* Static content (admin configuration control or website data)

The infrastructure needed to manage a microservice, keeping it running include, but are not limited to:

* Load balanacer
* Fault tolerance
* Logging
* Deplomyent/Downtime
* Versioning
* Dynamic Requests
* Compatible interfaces
* Source code management
* Publishing availability
* Authorization engine (LDAP or AD)
* Servers to house code
* Continuous delivery/continuous integration system

The pieces needed to run microservices but are not part of the service itself are non-added value coding, and keeping spent time managing them at a minimum is of the highest importance.  Depending on the system that is being used, more time may be needed, the cost of training new members ont he software may go up, etc...

Using Amazon's AWS ensures elimination of high cost low value infrastructure management.

### Using AWS to create microservices

