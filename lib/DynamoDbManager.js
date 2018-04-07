
function DynamoDbManager(serviceName, dynamoDbFactory) {
	this.ServiceName = serviceName;
	this.DynamoDbFactory = dynamoDbFactory;
}

DynamoDbManager.prototype.PublishDatabasePromise = function(stage, databaseSchemaList) {
	let creationPromise = databaseSchemaList.reduce((promise, genericTable) => {
        return promise.then(previousTables => {
            let table = genericTable;
            table.TableName = `${genericTable.TableName}.${this.ServiceName}.${stage}`;

            return this.DynamoDbFactory.describeTable({ TableName: table.TableName }).promise()
            .then(currentTable => {
                if(table.ProvisionedThroughput.ReadCapacityUnits === currentTable.Table.ProvisionedThroughput.ReadCapacityUnits &&
                    table.ProvisionedThroughput.WriteCapacityUnits === currentTable.Table.ProvisionedThroughput.WriteCapacityUnits) { return Promise.resolve({TableDescription: currentTable.Table}); }
                delete table.KeySchema;
                return this.DynamoDbFactory.updateTable(table).promise()
            }, () => this.DynamoDbFactory.createTable(table).promise())
            .then(newTable => {
                return Promise.resolve(previousTables.concat([{
                    Name: newTable.TableDescription.TableName,
                    Status: newTable.TableDescription.TableStatus,
                    ItemCount: newTable.TableDescription.ItemCount,
                    Arn: newTable.TableDescription.TableArn
                }]));
            })
            .catch(failure => {
                console.log(failure);
                return Promise.reject({Error: 'Failure publishing database schema.', Details: failure})
            });
        });
	}, Promise.resolve([]));
    return creationPromise;
}

module.exports = DynamoDbManager;