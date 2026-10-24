# Attio CLI

This project exposes the operations of the Attio API as commands. Terms follow Attio's own vocabulary for the data in a workspace and add the few the command line needs.

## Workspace data

**Workspace**:
An organization's Attio account, holding its Objects, Activities, Lists, and Workspace Members.
_Avoid_: Organization, tenant, account

**Workspace Member**:
A person with access to a Workspace.
_Avoid_: User

**Object**:
A kind of thing a Workspace keeps data about, such as companies or people.
_Avoid_: Table, entity, model

**Record**:
One instance of an Object.
_Avoid_: Row, item

**Activity**:
A kind of event a Workspace logs against Records, such as a phone call.
_Avoid_: Event type

**Activity Record**:
One logged event of an Activity.
_Avoid_: Record, Entry

**Attribute**:
A named, typed property defined on an Object, a List, or an Activity.
_Avoid_: Field, column, property

**Attribute Value**:
What a Record, an Activity Record, or an Entry holds for an Attribute, together with the period during which it held it.
_Avoid_: Field value

**Select Option**:
One of the values a select Attribute admits.
_Avoid_: Choice, tag

**Status**:
One of the stages a status Attribute admits.
_Avoid_: Stage, state

**List**:
A collection of Records of one Object that models a process.
_Avoid_: Pipeline, view

**Entry**:
The membership of a Record in a List, with Attribute Values of its own.
_Avoid_: List item, member

## Access

**Access Token**:
A credential that belongs to one Workspace and authorizes Operations on it.
_Avoid_: API key

**Scope**:
A permission an Access Token holds over one kind of Workspace data, to read it or to read and write it.
_Avoid_: Permission, role

## Command line

**Operation**:
One action the Attio API offers, identified by its HTTP method and path.
_Avoid_: Endpoint, API call

**Command**:
The invocation of one Operation, named after the Operation's page in Attio's API reference.
_Avoid_: Subcommand

**Group**:
The Commands for the Operations that Attio's API reference documents under one heading.
_Avoid_: Namespace, resource, tag
