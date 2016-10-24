'use strict';

const acorn = require('acorn');


function patternMatch(source, patterns, acornOption) {
    const pattern = new StatementPattern(patterns, acornOption);
    return pattern.match(source);
}

class StatementPattern {
    constructor(patterns, acornOption) {
        this._acornOption = Object.assign({}, acornOption);
        this._acornOption.locations = true;
        this._patternHeads = {};
        Object.keys(patterns).forEach(key => {
            const body = preprocessPatternAST(patterns[key], acornOption);
            if (body.length === 0) {
                return;
            }
            const heads = this._patternHeads[body[0].type];
            if (!heads) {
                this._patternHeads[body[0].type] = [{name: key, ast: body}];
            } else {
                heads.push({name: key, ast: body});
            }
        });
    }

    match(source) {
        const stack = [];
        const result = [];
        const ast = acorn.parse(source, this._acornOption); 
        walk(ast, this._patternHeads, stack, result);
        return result;
    }
}

function preprocessPatternAST(source, acornOption) {
    let position = 0;
    const convertedCode = [];
    const decrPositions = [];
    source.split(/(__decr__)/).forEach(fragment => {
        if (fragment === '__decr__') {
            decrPositions.push(position);
            fragment = 'const';
        }
        position += fragment.length;
        convertedCode.push(fragment);
    });
    const patternAST = acorn.parse(convertedCode.join(''), acornOption);
    var body = patternAST.body;
    if (body.length === 1 && body[0].type === 'ExpressionStatement') {
        body = [body[0].expression];
    }
    walkPattern(body, decrPositions);
    return body;
}

function walkPattern(node, decrPositions) {
    if (node.type === 'VariableDeclaration' && decrPositions.indexOf(node.start) !== -1) {
        delete node.kind;
    }
    Object.keys(node).forEach(key => {
        const value = node[key];
        if (Array.isArray(value)) {
            value.forEach(elem => {
                walkPattern(elem, decrPositions);
            });
        } else if (value.type) {
            walkPattern(value, decrPositions);
        }
    });
}


function walk(node, patterns, stack, result) {
    Object.keys(node).forEach(key => {
        const value = node[key];
        if (key === 'start' || key === 'end' || key === 'loc') {
            return;
        }
        if (Array.isArray(value)) {
            checkPattern(node, key, value, false, patterns, stack, result);
            value.forEach((elem, index) => {
                const copiedStack = stack.slice(0);
                copiedStack.push({node: node, key: key, index: index});
                walk(elem, patterns, copiedStack, result);
            });
        } else if (value instanceof acorn.Node) {
            checkPattern(node, key, [value], true, patterns, stack, result);
            const copiedStack = stack.slice(0);
            copiedStack.push({node: node, key: key});
            walk(value, patterns, copiedStack, result);
        }
    });
}

function checkPattern(parent, key, nodes, isSingle, patterns, stack, result) {
    var matchedPattern = patterns[nodes[0].type];
    if (!matchedPattern) {
        if (nodes[0].type === 'VariableDeclarator') {
            matchedPattern = patterns.AssignmentExpression;
        }
        if (!matchedPattern) {
            return;
        } 
    }
    matchedPattern.forEach(pattern => {
        for (var offset = 0; offset < (nodes.length - pattern.ast.length + 1); offset++) {
            var match = true;
            for (var i = 0; i < pattern.ast.length; i++) {
                if (!matchNode(nodes[offset+i], pattern.ast[i])) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const copiedStack = stack.slice(0);
                if (isSingle) {
                    copiedStack.push({node: parent, key: key});
                } else {
                    copiedStack.push({node: parent, key: key, index: offset});
                }
                result.push({name: pattern.name, stack: stack, node: nodes[offset]});
            }
        }
    });
}

function isWildCard(node) {
    return (node.type === 'Identifier' && node.name.startsWith('__') && node.name.endsWith('__'));
}

function matchNode(node, patternNode) {
    if (isWildCard(patternNode)) {
        switch (patternNode.name) {
            case '__any__':
                return true;
            case '__extra__':
                return true;
            case '__anyname__':
                return (node.type === 'Identifier');
            case '__number__':
                return (node.type === 'Literal' && typeof(node.value) === 'number');
            case '__string__':
                return (node.type === 'Literal' && typeof(node.value) === 'string');
            case '__boolean__':
                return (node.type === 'Literal' && typeof(node.value) === 'boolean');
        }
    }
    if (node.type !== patternNode.type) {
        if (node.type === 'VariableDeclarator' && patternNode.type === 'AssignmentExpression' && node.init && patternNode.operator === '=') {
            return matchNode(node.id, patternNode.left) && matchNode(node.init, patternNode.right);
        }
        return false;
    }

    // recursive check;
    var keys = Object.keys(patternNode);
    for (var i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === 'start' || key === 'end' || key === 'value' || key === 'loc') {
            continue;
        }
        const value = node[key];
        if (Array.isArray(value)) {
            const array = value;
            const patternArray = patternNode[key];
            var length = array.length;
            if (array.length > patternArray.length) {
                var last = patternArray.slice(-1);
                if (last.length === 1 && last[0].type === 'Identifier' && last[0].name === '__extra__') {
                    length = patternArray.length - 1;
                } else {
                    return false;
                }
            } else if (array.length < patternArray.length) {
                    return false;
            }
            for (var j = 0; j < length; j++) {
                if (!matchNode(array[j], patternArray[j])) {
                    return false;
                }
            }
        } else if (value.type) {
            if (!matchNode(value, patternNode[key])) {
                return false;
            }
        } else if (value !== patternNode[key]) {
            return false;
        }
    }
     
    return true;
}

module.exports = {
    StatementPattern: StatementPattern,
    patternMatch: patternMatch
};
