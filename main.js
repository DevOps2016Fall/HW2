var esprima = require("esprima");
var options = {tokens: true, tolerant: true, loc: true, range: true};
var faker = require("faker");
var fs = require("fs");
faker.locale = "en";
var mock = require('mock-fs');
var _ = require('underscore');
var Random = require('random-js');
var Combinatorics = require('js-combinatorics');

function main() {
    var args = process.argv.slice(2);

    if (args.length == 0) {
        args = ["subject.js"];
    }
    var filePath = args[0];

    constraints(filePath);

    generateTestCases()

}

var engine = Random.engines.mt19937().autoSeed();

function createConcreteIntegerValue(greaterThan, constraintValue) {
    if (greaterThan)
        return Random.integer(constraintValue, constraintValue + 10)(engine);
    else
        return Random.integer(constraintValue - 10, constraintValue)(engine);
}

function Constraint(properties) {
    this.ident = properties.ident;
    this.expression = properties.expression;
    this.operator = properties.operator;
    this.value = properties.value;
    this.funcName = properties.funcName;
    this.invValue = properties.invValue;
    // Supported kinds: "fileWithContent","fileExists"
    // integer, string, phoneNumber
    this.kind = properties.kind;
}

function cartesianProduct(arr) {
    return arr.reduce(function (a, b) {
        return a.map(function (x) {
            return b.map(function (y) {
                return x.concat(y);
            })
        }).reduce(function (a, b) {
            return a.concat(b)
        }, [])
    }, [[]])
}

//http://stackoverflow.com/questions/12303989/cartesian-product-of-multiple-arrays-in-javascript

function fakeDemo() {
    console.log(faker.phone.phoneNumber());
    console.log(faker.phone.phoneNumberFormat());
    console.log(faker.phone.phoneFormats());
}

var functionConstraints =
{}

var mockFileLibrary =
{
    pathExists: {
        'path/fileExists': {
            fss: "sdf "
        }
    },

    fileWithContent: {
        pathContent: {
            file1: 'text content',
            file2: "sdfd"
        },
        pathContentEmpty: {
            file2: ''
        }
    }
};

function generateTestCases() {

    var content = "var subject = require('./subject.js')\nvar mock = require('mock-fs');\n";
    for (var funcName in functionConstraints) {
        var params = {};
        var param_value = {};
        var list_value = []
        // initialize params
        for (var i = 0; i < functionConstraints[funcName].params.length; i++) {
            var paramName = functionConstraints[funcName].params[i];
            //params[paramName] = '\'' + faker.phone.phoneNumber()+'\'';
            params[paramName] = '\'\'';
            // param_value[paramName] = '\'\'';

        }


        // update parameter values based on known constraints.
        var constraints = functionConstraints[funcName].constraints;
        // Handle global constraints...
        var fileWithContent = _.some(constraints, {kind: 'fileWithContent'});
        var pathExists = _.some(constraints, {kind: 'fileExists'});
        var format_options = _.some(constraints, {kind: 'format_options'});


        // plug-in values for parameters
        for (var c = 0; c < constraints.length; c++) {
            var constraint = constraints[c];
            var temp = []
            if (params.hasOwnProperty(constraint.ident)) {
                params[constraint.ident] = constraint.value;
                temp.push(constraint.value);
                if (constraint.invValue != undefined) {
                    temp.push(constraint.invValue);
                }
                if (param_value.hasOwnProperty(constraint.ident)) {
                    param_value[constraint.ident].push.apply(param_value[constraint.ident], temp)
                }
                else {
                    param_value[constraint.ident] = temp
                }
            }
        }
        for (key in params) {
            if (param_value[key] == undefined) {
                continue;
            }
            list_value.push(param_value[key])
        }
        // console.log(cartesianProduct(list_value))
        pairs = cartesianProduct(list_value)
        for (var i = 0; i < pairs.length; i++) {
            if (!pathExists || !fileWithContent) {
                if (pairs[0].length > 0) {
                    if (format_options) {
                        var args = ""
                        args = ["'" + faker.phone.phoneNumberFormat().toString() + "'",
                            "'" + faker.phone.phoneFormats().toString() + "'",
                            pairs[i]
                        ]
                        content += "subject.{0}({1});\n".format(funcName, args);
                    }
                    else {
                        content += "subject.{0}({1});\n".format(funcName, pairs[i]);
                    }
                }
            }
        }

        // console.log(funcName+"length of constraints:" +constraints.length)
        // Prepare function arguments.
        var args = Object.keys(params).map(function (k) {
            return params[k];
        }).join(",");
        if (pathExists || fileWithContent) {
            content += generateMockFsTestCases(pathExists, fileWithContent, funcName, args);
            // Bonus...generate constraint variations test cases....
            content += generateMockFsTestCases(!pathExists, fileWithContent, funcName, args);
            content += generateMockFsTestCases(pathExists, !fileWithContent, funcName, args);
            content += generateMockFsTestCases(!pathExists, !fileWithContent, funcName, args);
        }
        else {
            // Emit simple test case.
            content += "subject.{0}({1});\n".format(funcName, args);
        }

    }


    fs.writeFileSync('test.js', content, "utf8");

}

function generateMockFsTestCases(pathExists, fileWithContent, funcName, args) {
    var testCase = "";
    // Build mock file system based on constraints.
    var mergedFS = {};
    if (pathExists) {
        for (var attrname in mockFileLibrary.pathExists) {
            mergedFS[attrname] = mockFileLibrary.pathExists[attrname];
        }
    }
    if (fileWithContent) {
        for (var attrname in mockFileLibrary.fileWithContent) {
            mergedFS[attrname] = mockFileLibrary.fileWithContent[attrname];
        }
    }

    testCase +=
        "mock(" +
        JSON.stringify(mergedFS)
        +
        ");\n";

    testCase += "\tsubject.{0}({1});\n".format(funcName, args);
    testCase += "mock.restore();\n";
    return testCase;
}

function constraints(filePath) {
    var buf = fs.readFileSync(filePath, "utf8");
    var result = esprima.parse(buf, options);

    traverse(result, function (node) {
        if (node.type === 'FunctionDeclaration') {
            var funcName = functionName(node);
            // console.log("Line : {0} Function: {1}".format(node.loc.start.line, funcName ));

            var params = node.params.map(function (p) {
                return p.name
            });

            functionConstraints[funcName] = {constraints: [], params: params};

            // Check for expressions using argument.
            traverse(node, function (child) {
                if (child.type === 'BinaryExpression' && child.operator == "==") {
                    if (child.left.type == 'Identifier' && params.indexOf(child.left.name) > -1) {
                        // get expression from original source code:
                        var expression = buf.substring(child.range[0], child.range[1]);
                        var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
                        var temp;
                        if (rightHand == "undefined") temp = 100;
                        else temp = "'a" + rightHand + "inverseValue'";
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.left.name,
                                    value: rightHand,
                                    invValue: temp,
                                    funcName: funcName,
                                    kind: "integer",
                                    operator: child.operator,
                                    expression: expression
                                }));
                    }
                    if (child.left.type == 'Identifier' && child.left.name == "area") {
                        var rightHand = buf.substring(child.right.range[0], child.right.range[1])
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: 'phoneNumber',
                                    value: rightHand,
                                    invValue: "'a" + rightHand + "inverseValue'"
                                }));
                    }
                    if (child.left.type == "CallExpression" && child.left.callee.property && child.left.callee.property.name == "indexOf") {
                        var expression = buf.substring(child.range[0], child.range[1]);
                        var leftHand = buf.substring(child.left.arguments[0].range[0], child.left.arguments[0].range[1]);
                        console.log(child.left.callee.object.name)
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.left.callee.object.name,
                                    value: leftHand,
                                    invValue: "'a" + leftHand + "inverseValue'",
                                    funcName: funcName,
                                    kind: "integer",
                                    operator: child.operator,
                                    expression: expression
                                }));

                    }
                }

                if (child.type === 'LogicalExpression' && child.operator == "||") {
                    if ((child.right.type == 'UnaryExpression') && (child.right.argument.type == 'MemberExpression')) {
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.right.argument.object.name,
                                    value: '{normalize: true}',
                                    invValue: '{normalize: false}',
                                    funcName: funcName,
                                    kind: 'format_options',
                                    operator: child.operator,
                                    expression: expression
                                }));
                    }
                }

                if (child.type === 'BinaryExpression' && child.operator == "!=") {
                    if (child.left.type == 'Identifier' && params.indexOf(child.left.name) > -1) {
                        // get expression from original source code:
                        var expression = buf.substring(child.range[0], child.range[1]);
                        var rightHand = buf.substring(child.right.range[0], child.right.range[1]);
                        var temp;
                        if (rightHand == "undefined") temp = 100;
                        else temp = "'a" + rightHand + "inverseValue'";
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.left.name,
                                    value: rightHand,
                                    invValue: temp,
                                    funcName: funcName,
                                    kind: "integer",
                                    operator: child.operator,
                                    expression: expression
                                }));
                    }
                    if (child.left.type == 'Identifier' && child.left.name == "area") {
                        var rightHand = buf.substring(child.right.range[0], child.right.range[1])
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: 'phoneNumber',
                                    value: rightHand,
                                    invValue: "'a" + rightHand + "inverseValue'"
                                }));
                    }
                }

                if (child.type === 'BinaryExpression' && child.operator == "<") {
                    if (child.left.type == 'Identifier' && params.indexOf(child.left.name) > -1) {
                        // get expression from original source code:
                        var expression = buf.substring(child.range[0], child.range[1]);
                        var rightHand = parseInt(buf.substring(child.right.range[0], child.right.range[1]));
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.left.name,
                                    value: rightHand,
                                    invValue: rightHand - 1,
                                    funcName: funcName,
                                    kind: "integer",
                                    operator: child.operator,
                                    expression: expression
                                }));
                    }
                }

                if (child.type === 'BinaryExpression' && child.operator == ">") {
                    if (child.left.type == 'Identifier' && params.indexOf(child.left.name) > -1) {
                        // get expression from original source code:
                        var expression = buf.substring(child.range[0], child.range[1]);
                        var rightHand = parseInt(buf.substring(child.right.range[0], child.right.range[1]));
                        functionConstraints[funcName].constraints.push(
                            new Constraint(
                                {
                                    ident: child.left.name,
                                    value: rightHand,
                                    invValue: rightHand + 1,
                                    funcName: funcName,
                                    kind: "integer",
                                    operator: child.operator,
                                    expression: expression
                                }));
                    }
                }

                if (child.type == "CallExpression" &&
                    child.callee.property &&
                    child.callee.property.name == "readFileSync") {
                    for (var p = 0; p < params.length; p++) {
                        if (child.arguments[0].name == params[p]) {
                            functionConstraints[funcName].constraints.push(
                                new Constraint(
                                    {
                                        ident: params[p],
                                        value: "'pathContent/file1'",
                                        funcName: funcName,
                                        kind: "fileWithContent",
                                        operator: child.operator,
                                        expression: expression
                                    }));
                        }
                    }
                }

                if (child.type == "CallExpression" &&
                    child.callee.property &&
                    child.callee.property.name == "existsSync") {
                    for (var p = 0; p < params.length; p++) {
                        if (child.arguments[0].name == params[p]) {
                            functionConstraints[funcName].constraints.push(
                                new Constraint(
                                    {
                                        ident: params[p],
                                        // A fake path to a file
                                        value: "'path/fileExists'",
                                        funcName: funcName,
                                        kind: "fileExists",
                                        operator: child.operator,
                                        expression: expression
                                    }));
                        }
                    }
                }

            });

            console.log(functionConstraints[funcName]);

        }
    });
}

function traverse(object, visitor) {
    var key, child;

    visitor.call(null, object);
    for (key in object) {
        if (object.hasOwnProperty(key)) {
            child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}

function traverseWithCancel(object, visitor) {
    var key, child;

    if (visitor.call(null, object)) {
        for (key in object) {
            if (object.hasOwnProperty(key)) {
                child = object[key];
                if (typeof child === 'object' && child !== null) {
                    traverseWithCancel(child, visitor);
                }
            }
        }
    }
}

function functionName(node) {
    if (node.id) {
        return node.id.name;
    }
    return "";
}


if (!String.prototype.format) {
    String.prototype.format = function () {
        var args = arguments;
        return this.replace(/{(\d+)}/g, function (match, number) {
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
                ;
        });
    };
}

main();